/**
 * Stagent 服务核心：把账本、执行器、投影与改动编排连起来，供 HTTP 层调用。
 *
 * 状态只由服务端从事件推导：没有任何方法能直接把功能或例子写成"已验证"（Invariant 2），
 * 已验证只能来自执行器写入的 run.completed；改动阶段同样只由事件推导（§5.4）。
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize, sep } from 'node:path';
import { activeChangeIdFromLines, knownHead, projectChanges, type ChangeView, type ChangesProjection } from '../changes/changes.js';
import { loadConfig, type StagentConfig } from '../config/config.js';
import { cleanOrphanSnapshots } from '../evidence/snapshots.js';
import { computeWorkTreeHash, type WorkTreeHashResult } from '../evidence/worktree-hash.js';
import { CHECKS_RELATIVE_DIR, runChecks, type CheckSpec } from '../executor/executor.js';
import { git, headCommit, isAncestor, UNBORN_COMMIT } from '../git/git.js';
import { assertReason, Ledger, LedgerLockedError } from '../ledger/ledger.js';
import type { AuthAction, EventOf, ExampleKind, LedgerLine, Track } from '../ledger/types.js';
import { buildOverview, type Overview, type RunProgressView } from '../projection/overview.js';
import { project, type FeatureView, type LedgerProjection } from '../projection/projection.js';
import { AuthError, Authorizer, restoreLockedCheck, snapshotForRelock, type AuthRequest, type AuthResult, type DanglingAuth, type TamperedCheck } from './auth.js';
import { EventBus } from './event-bus.js';
import { WorkspaceWatcher } from './watcher.js';
import { ClaudeCodeExecutor } from '../agent/claude-code.js';
import type { AgentAvailability, AgentExecutor } from '../agent/types.js';
import { UsageStore, type BudgetStatus } from '../agent/usage.js';
import type { CheckResult, RunPurpose } from '../ledger/types.js';
import type { RecordDraft } from './flows/records-flow.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceOptions {
  /** 测试注入配置；默认读 .stagent/config.json。 */
  config?: StagentConfig;
  /** 外部改动静止多久算"静止"（§5.3：防抖 2 秒）。 */
  watchDebounceMs?: number;
  /** 外部改动静止后自动进入检查（默认 true）。 */
  autoCheckExternal?: boolean;
  /** 测试用：模拟某个授权动作在消费后、副作用前崩溃。 */
  crashBefore?: AuthAction;
  /** AI 执行器（§8）；默认 Claude Code。传 null 表示不接 AI（M2 的手动流程）。 */
  agent?: AgentExecutor | null;
  /** 建改动后自动开始 AI 任务（小改动 → 实现，新功能 → 起草例子），默认 true。 */
  autoAgent?: boolean;
  /** 文档生成防抖（毫秒），默认 500；0 表示关闭自动生成。 */
  docsDebounceMs?: number;
}

/** 进行中的 AI 任务（同一时间最多一个）。 */
export interface AgentTaskView {
  kind: 'classify' | 'draft' | 'rewrite' | 'implement' | 'fix' | 'scan' | 'baseline' | 'plan' | 'records' | 'rule' | 'ask' | 'attribute';
  label: string;
  changeId: string | null;
  line: string;
  log: string[];
  startedAt: string;
  sessionId: string | null;
}

/** 一次读盘得到的完整状态。 */
interface Snapshot {
  lines: readonly LedgerLine[];
  current: WorkTreeHashResult;
  projection: LedgerProjection;
  changes: ChangesProjection;
}

export type OverviewResponse = Overview & {
  runError: string | null;
  project: { name: string; branch: string | null; port?: number };
  auth: { dangling: DanglingAuth[]; tamperedChecks: TamperedCheck[]; releaseConfigured: boolean };
  agent: { name: string | null; availability: AgentAvailability; task: AgentTaskView | null; lastError: string | null };
  budget: BudgetStatus;
};

export class StagentService {
  readonly bus = new EventBus();
  private run: (RunProgressView & { controller: AbortController; promise: Promise<void>; changeId: string | null }) | null = null;
  private lastRunError: string | null = null;
  private watcher: WorkspaceWatcher | null = null;
  private lastSeenWorkTreeHash: string | null = null;
  /** 运行进行中又来了需要检查的事情（外部改动静止、未托管提交），运行结束后再跑一次。 */
  private pendingCheck = false;
  /** 外部改动检测串行执行，避免同一批改动建出两个改动。 */
  private settling: Promise<void> = Promise.resolve();
  private activeIdCache: string | null = null;

  readonly authorizer: Authorizer;
  readonly agent: AgentExecutor | null;
  /** 进行中的 AI 任务（运行时状态）。 */
  agentTask: (AgentTaskView & { controller: AbortController; promise: Promise<void> }) | null = null;
  agentError: string | null = null;
  /** 中断的实现会话（changeId → SDK session_id），供续接。 */
  readonly interruptedSessions = new Map<string, string>();
  /** 起草会话的 Claude Code session_id（守卫据此放行 .stagent/checks/draft/**）。 */
  readonly draftingSessions = new Set<string>();
  /** 合并后 AI 起草、等你保存的记录卡（不进账本，§10）。 */
  recordDrafts: RecordDraft[] = [];
  /** 扫描接入的运行时状态（§9）。 */
  scan: { running: boolean; found: string[]; error: string | null; startedAt: string } | null = null;
  /** 「保留现状」后不再提示的规则区块指纹。 */
  rulesDriftAck = new Set<string>();
  /** 服务实际端口（顶栏显示）。 */
  port: number | null = null;
  /** 守卫 hook 自检结果（startService 启动时检查；null = 没检查过）。不通过时不驱动 Claude Code 改代码。 */
  hookHealth: import('../guard/install.js').HookHealth | null = null;
  /**
   * §14 防盖章：本进程内「读过」勾选（changeId → exampleId）。
   * 只存在服务内存里——刷新页面要重新勾；草稿被改/丢弃会清掉对应勾选。
   * 结论卡与直调 API 都必须过这道门，不能只靠 DraftReview 面板禁用按钮。
   */
  private readonly draftAcks = new Map<string, Set<string>>();
  private availabilityCache: { at: number; value: AgentAvailability } | null = null;
  private readonly background = new Set<Promise<unknown>>();
  private docsTimer: NodeJS.Timeout | null = null;

  private constructor(
    readonly root: string,
    readonly ledger: Ledger,
    readonly options: ServiceOptions,
  ) {
    this.agent = options.agent === undefined ? new ClaudeCodeExecutor() : options.agent;
    this.bus.subscribe((e) => {
      if (e.type === 'ledger.appended') this.scheduleDocs();
    });
    this.authorizer = new Authorizer(
      {
        root,
        ledger,
        config: () => this.config(),
        state: async () => {
          const s = await this.snapshot();
          return {
            lines: s.lines,
            features: s.projection.features,
            active: s.changes.active,
            changes: s.changes.changes,
            workTreeHash: s.current.workTreeHash,
          };
        },
        write: (fn) => this.write(fn),
        isRunning: () => this.run !== null,
        acknowledgeWorkTree: async () => {
          this.lastSeenWorkTreeHash = (await this.snapshot()).current.workTreeHash;
        },
        requestRegression: async () => this.requestCheck(await this.snapshot()),
      },
      options.crashBefore ? { crashBefore: options.crashBefore } : {},
    );
  }

  /** 打开账本（版本不符会抛错）；账本完好时清理孤儿快照。 */
  static async open(root: string, options: ServiceOptions = {}): Promise<StagentService> {
    const ledger = await Ledger.open(root);
    if (ledger.state === 'ok') await cleanOrphanSnapshots(root, ledger.events());
    const svc = new StagentService(root, ledger, options);
    const { loadRecordDrafts } = await import('./flows/records-flow.js');
    await loadRecordDrafts(svc);
    const { detectInterruption } = await import('./flows/agent-flow.js');
    await detectInterruption(svc).catch(() => undefined);
    return svc;
  }

  async config(): Promise<StagentConfig> {
    return this.options.config ?? loadConfig(this.root);
  }

  /** 重新读盘校验账本，按当前工作区投影功能与改动（流程模块也用它取一致的状态）。 */
  async state(): Promise<Snapshot> {
    return this.snapshot();
  }

  private async snapshot(): Promise<Snapshot> {
    const report = await this.ledger.verify();
    const config = await this.config();
    const current = await computeWorkTreeHash(this.root, { ignoreGlobs: config.evidence.ignoreGlobs });
    const projection = project(report.lines, current);
    const changes = projectChanges(report.lines, {
      current,
      projection,
      runningChangeId: this.run?.changeId ?? null,
    });
    this.activeIdCache = changes.active?.changeId ?? null;
    return { lines: report.lines, current, projection, changes };
  }

  async projection(): Promise<LedgerProjection> {
    return (await this.snapshot()).projection;
  }

  /** §14 健康指标（防盖章等），GET /api/health。 */
  async health(): Promise<import('../metrics/health.js').HealthReport> {
    const { computeHealth } = await import('../metrics/health.js');
    const { readMetrics } = await import('../metrics/metrics.js');
    return computeHealth((await this.snapshot()).lines, await readMetrics(this.ledger.projectId ?? undefined));
  }

  private async rubberStampWarning(lines: readonly LedgerLine[]): Promise<{ healthWarning?: string }> {
    const { computeHealth } = await import('../metrics/health.js');
    const { readMetrics } = await import('../metrics/metrics.js');
    const h = computeHealth(lines, await readMetrics(this.ledger.projectId ?? undefined));
    return h.rubberStamp.text ? { healthWarning: h.rubberStamp.text } : {};
  }

  async refreshHookHealth(): Promise<void> {
    const { checkHookHealth } = await import('../guard/install.js');
    this.hookHealth = await checkHookHealth(this.root).catch((err: Error) => ({ ok: false, reason: err.message }));
  }

  async overview(): Promise<OverviewResponse> {
    const { projection, changes, lines } = await this.snapshot();
    const config = await this.config();
    const auth = {
      dangling: this.authorizer.dangling(lines),
      tamperedChecks: await this.authorizer.tamperedChecks(projection.features),
      releaseConfigured: !!config.releaseCommand,
    };
    const availability = await this.agentAvailability();
    const budget = await this.budget(changes.active?.changeId ?? null);
    const extras = await (await import('./flows/overview-extras.js')).overviewExtras(this, { lines, changes: changes.changes });
    const overview = buildOverview({
      projection,
      ledger: { state: this.ledger.state, brokenLinks: this.ledger.report.brokenLinks, anchor: this.ledger.anchorStatus },
      run: this.run ? publicRun(this.run) : null,
      change: changes.active,
      draftsAcknowledged: changes.active ? this.draftsFullyAcknowledged(changes.active) : true,
      auth,
      agent: { available: availability.available, reason: availability.reason, busy: this.agentTask !== null, kind: this.agentTask?.kind ?? null },
      ...(this.hookHealth && !this.hookHealth.ok ? { guardProblem: this.hookHealth.reason ?? '守卫 hook 跑不起来' } : {}),
      ...(await this.rubberStampWarning(lines)),
      budget,
      ...extras,
    });
    return {
      ...overview,
      runError: this.lastRunError,
      project: { name: basename(this.root), branch: await currentBranch(this.root), ...(this.port ? { port: this.port } : {}) },
      auth,
      agent: { name: this.agent?.name ?? null, availability, task: this.agentTask ? publicTask(this.agentTask) : null, lastError: this.agentError },
      budget,
    };
  }

  /** AI 执行器是否可用（缓存 30 秒）。 */
  async agentAvailability(): Promise<AgentAvailability> {
    if (!this.agent) return { available: false, reason: '没有接入 AI 执行器', hint: '本项目以手动或 Cursor 方式使用 Stagent' };
    if (this.availabilityCache && Date.now() - this.availabilityCache.at < 30_000) return this.availabilityCache.value;
    const value = await this.agent.availability().catch((err: Error) => ({ available: false, reason: err.message }));
    this.availabilityCache = { at: Date.now(), value };
    return value;
  }

  usageStore(): UsageStore {
    return new UsageStore(this.ledger.projectId ?? 'unknown');
  }

  async budget(changeId: string | null): Promise<BudgetStatus> {
    return this.usageStore().status(await this.config(), this.ledger.lines(), changeId);
  }

  /** 相关事件之后重新生成 .stagent/docs/*.md（防抖）。 */
  private scheduleDocs(): void {
    const ms = this.options.docsDebounceMs ?? 500;
    if (ms === 0) return;
    if (this.docsTimer) clearTimeout(this.docsTimer);
    this.docsTimer = setTimeout(() => {
      this.docsTimer = null;
      void this.regenerateDocs().catch(() => undefined);
    }, ms);
    this.docsTimer.unref?.();
  }

  async regenerateDocs(): Promise<string[]> {
    const { writeDocs } = await import('./flows/docs-flow.js');
    return writeDocs(this);
  }

  /** 记录不占用任务槽的后台工作（合并后起草记录卡等），dispose 与测试可以等它们结束。 */
  trackBackground(p: Promise<unknown>): void {
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  async waitForBackground(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  async dispose(): Promise<void> {
    await this.waitForBackground();
    if (this.docsTimer) clearTimeout(this.docsTimer);
    this.docsTimer = null;
    this.agentTask?.controller.abort();
    await this.agentTask?.promise.catch(() => undefined);
    await this.stopWatching();
    await this.waitForRun();
  }

  async features(): Promise<FeatureView[]> {
    return (await this.projection()).features;
  }

  async feature(featureId: string): Promise<FeatureView> {
    const f = (await this.features()).find((x) => x.featureId === featureId);
    if (!f) throw new HttpError(404, `功能 ${featureId} 不存在`);
    return f;
  }

  get running(): boolean {
    return this.run !== null;
  }

  // ---- 改动（§5） ----

  async changes(): Promise<ChangesProjection> {
    return (await this.snapshot()).changes;
  }

  async change(changeId: string): Promise<ChangeView> {
    const c = (await this.changes()).changes.find((x) => x.changeId === changeId);
    if (!c) throw new HttpError(404, `改动 ${changeId} 不存在`);
    return c;
  }

  /** 当前进行中的改动 id（守卫写 guard.blocked 时引用；取最近一次读盘的结果）。 */
  activeChangeId(): string | null {
    return this.activeIdCache;
  }

  /** 该 Claude Code 会话是否是「确认例子」阶段的起草会话：只有这时守卫放行 .stagent/checks/draft/**（§6）。 */
  isDraftingSession(sessionId?: string): boolean {
    return !!sessionId && this.draftingSessions.has(sessionId) && this.agentTask !== null && ['draft', 'rewrite', 'baseline'].includes(this.agentTask.kind);
  }

  /**
   * 创建改动（§5.0）：同一时间只能有一个进行中的改动，否则 409。
   * 由 Stagent 发起的改动将由 Claude Code 执行（M3），source 记为 claude-code。
   */
  async createChange(input: {
    description?: unknown;
    track?: unknown;
    planId?: string;
    stepId?: string;
    targetFeatureIds?: string[];
  }): Promise<ChangeView> {
    this.assertWritable();
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!description) throw new HttpError(400, '请描述这次改动');
    const track: Track = input.track === 'feature' ? 'feature' : 'small';
    const snap = await this.snapshot();
    if (snap.changes.active) {
      throw new HttpError(409, `已有进行中的改动「${snap.changes.active.description}」，请先合并或放弃`);
    }
    const changeId = newId('c');
    const baseCommit = await headCommit(this.root);
    const extra = {
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      ...(input.targetFeatureIds?.length ? { targetFeatureIds: input.targetFeatureIds } : {}),
    };
    // 在账本写锁内再查一次，两个并发请求只有一个能建成（另一个 409）。
    await this.write(() =>
      this.ledger.transaction(async (tx) => {
        if (activeChangeIdFromLines(tx.report.lines)) throw new HttpError(409, '已有进行中的改动，请先合并或放弃');
        await tx.append({ type: 'change.started', changeId, track, baseCommit, source: 'claude-code', description, ...extra });
      }),
    );
    return this.change(changeId);
  }

  /** 升档 / 降档（§5.2）。降档只能在本改动还没有锁定例子时进行。 */
  async setTrack(changeId: string, input: { track?: unknown; reason?: unknown }): Promise<ChangeView> {
    const c = await this.activeChange(changeId);
    const track = input.track;
    if (track !== 'small' && track !== 'feature') throw new HttpError(400, 'track 必须是 small 或 feature');
    if (track === c.track) throw new HttpError(409, `已经是${track === 'feature' ? '新功能档' : '小改动档'}`);
    if (track === 'small' && c.lockedExampleIds.length > 0) {
      throw new HttpError(409, '本改动已经锁定了例子，不能降为小改动档');
    }
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : undefined;
    await this.write(() =>
      this.ledger.append(
        track === 'feature'
          ? { type: 'change.track_upgraded', changeId, by: 'user' }
          : { type: 'change.track_downgraded', changeId, by: 'user', ...(reason ? { reason } : {}) },
      ),
    );
    return this.change(changeId);
  }

  /**
   * 新功能档：起草一个验收例子（情况 → 操作 → 期望）。M3-2 起由 Claude Code 起草；
   * 目前由你手写检查文件（放在 .stagent/checks/ 下）后在这里登记。可指定已有功能或新建功能。
   */
  async draftExample(changeId: string, input: Record<string, unknown>): Promise<{ exampleId: string; featureId: string }> {
    const c = await this.activeChange(changeId);
    if (c.track !== 'feature') throw new HttpError(409, '小改动档不新增例子；需要新例子请先升为新功能档');
    // 实现中也可以补例子：有未锁定的草稿时，改动回到「确认例子」。
    if (c.phase === 'checking') throw new HttpError(409, '检查进行中，结束后再起草例子');
    const text = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
    const given = text('given');
    const when = text('when');
    const then = text('then');
    if (!given || !when || !then) throw new HttpError(400, '情况、操作、期望都要填写');
    const kind: ExampleKind = input.kind === 'visual' ? 'visual' : 'behavior';
    const checkPath = checkPathInput(text('checkPath'));
    try {
      await readFile(join(this.root, checkPath));
    } catch {
      throw new HttpError(400, `检查文件 ${checkPath} 不存在`);
    }

    let featureId = text('featureId');
    const featureName = text('featureName');
    const features = await this.features();
    if (featureId && !features.some((f) => f.featureId === featureId)) throw new HttpError(404, `功能 ${featureId} 不存在`);
    if (!featureId && !featureName) throw new HttpError(400, '请选择已有功能或填写新功能名称');
    const exampleId = newId('e');
    const createFeature = !featureId;
    if (createFeature) featureId = newId('f');
    await this.write(() =>
      this.ledger.transaction(async (tx) => {
        if (createFeature) await tx.append({ type: 'feature.created', featureId, name: featureName, origin: 'new' });
        await tx.append({ type: 'example.drafted', exampleId, featureId, given, when, then, kind, checkPath, changeId });
      }),
    );
    return { exampleId, featureId };
  }

  /** 当前改动已勾选「读过」的草稿 id（供 overview / 测试）。 */
  acknowledgedDraftIds(changeId: string): string[] {
    return [...(this.draftAcks.get(changeId) ?? [])];
  }

  /** 待锁定草稿是否已全部勾选「读过」。无待锁定草稿时视为 true。 */
  draftsFullyAcknowledged(change: Pick<ChangeView, 'changeId' | 'pendingDraftIds'>): boolean {
    if (change.pendingDraftIds.length === 0) return true;
    const acked = this.draftAcks.get(change.changeId);
    return change.pendingDraftIds.every((id) => acked?.has(id));
  }

  /**
   * POST /api/changes/:id/examples/acknowledge：记录「读过」勾选。
   * 传空数组可清空；只会保留仍属于本改动待锁定草稿的 id。
   */
  async acknowledgeDrafts(changeId: string, input: { exampleIds?: unknown }): Promise<{ acknowledgedExampleIds: string[] }> {
    const c = await this.activeChange(changeId);
    if (!Array.isArray(input.exampleIds)) throw new HttpError(400, 'exampleIds 必须是数组');
    const wanted = input.exampleIds.filter((x): x is string => typeof x === 'string');
    const pending = new Set(c.pendingDraftIds);
    const unknown = wanted.filter((id) => !pending.has(id));
    if (unknown.length) throw new HttpError(409, `这些例子不是本改动的待锁定草稿：${unknown.join('、')}`);
    this.draftAcks.set(changeId, new Set(wanted));
    return { acknowledgedExampleIds: this.acknowledgedDraftIds(changeId) };
  }

  /** 草稿被改写或丢弃后，清掉对应「读过」勾选（改过必须重新确认）。 */
  clearDraftAcks(changeId: string, exampleIds?: readonly string[]): void {
    if (!exampleIds) {
      this.draftAcks.delete(changeId);
      return;
    }
    const set = this.draftAcks.get(changeId);
    if (!set) return;
    for (const id of exampleIds) set.delete(id);
    if (set.size === 0) this.draftAcks.delete(changeId);
  }

  /**
   * red-check / lock 共用：可用 body.acknowledgedExampleIds 一次性勾选，再校验目标草稿都已读过。
   */
  ensureDraftsAcknowledged(changeId: string, exampleIds: readonly string[], body: { acknowledgedExampleIds?: unknown } = {}): void {
    if (Array.isArray(body.acknowledgedExampleIds)) {
      const extra = body.acknowledgedExampleIds.filter((x): x is string => typeof x === 'string');
      const set = this.draftAcks.get(changeId) ?? new Set<string>();
      for (const id of extra) set.add(id);
      this.draftAcks.set(changeId, set);
    }
    const acked = this.draftAcks.get(changeId);
    const missing = exampleIds.filter((id) => !acked?.has(id));
    if (missing.length) {
      throw new HttpError(400, `请先逐条勾选「读过」再继续（还有 ${missing.length} 条未确认）`);
    }
  }

  /**
   * 确认并锁定例子（POST /api/changes/:id/examples/lock）：写检查快照与 example.locked。
   * 新功能档要求每条例子已有合格的先失败检查或豁免，且内容哈希一致，否则 422（Invariant 7，§5.1）。
   * 不传 exampleIds 时锁定本改动全部草稿。
   * §14：必须先对目标草稿勾选「读过」（面板、结论卡、直调 API 同一道门）。
   */
  async lockExamples(changeId: string, input: { exampleIds?: unknown; acknowledgedExampleIds?: unknown }): Promise<ChangeView> {
    const c = await this.activeChange(changeId);
    const ids = Array.isArray(input.exampleIds) ? input.exampleIds.filter((x): x is string => typeof x === 'string') : c.pendingDraftIds;
    if (ids.length === 0) throw new HttpError(400, '没有待锁定的例子草稿');
    const unknown = ids.filter((id) => !c.pendingDraftIds.includes(id));
    if (unknown.length) throw new HttpError(409, `这些例子不是本改动的待锁定草稿：${unknown.join('、')}`);
    this.ensureDraftsAcknowledged(changeId, ids, input);
    const { lockDrafts } = await import('./flows/examples-flow.js');
    await lockDrafts(
      this,
      c.pendingDrafts.filter((d) => ids.includes(d.exampleId)),
      { changeId, requireRed: c.track === 'feature' },
    );
    this.clearDraftAcks(changeId, ids);
    return this.change(changeId);
  }

  /** 实现完成，开始检查：对全部已锁定例子跑全量回归（§5.2 / §7）。 */
  async startCheck(changeId: string): Promise<{ total: number }> {
    const c = await this.activeChange(changeId);
    if (c.phase === 'confirm_examples' || c.phase === 'red_check') {
      throw new HttpError(409, '还在确认例子阶段：先锁定例子再开始检查');
    }
    return this.startRegression();
  }

  // ---- 运行 ----

  /** 手动全量回归：运行全部已锁定例子（v1 不做选择性运行）。异步执行，进度经 SSE 推送。 */
  async startRegression(): Promise<{ total: number }> {
    if (this.run) throw new HttpError(409, '已有检查在运行');
    this.assertWritable();
    const snap = await this.snapshot();
    const features = snap.projection.features;
    const checks: CheckSpec[] = features.flatMap((f) =>
      f.examples.map((x) => ({
        exampleId: x.exampleId,
        checkPath: x.checkPath,
        source: { kind: 'snapshot' as const, checkSnapshotId: x.checkHash },
      })),
    );
    if (checks.length === 0) throw new HttpError(400, '还没有锁定的例子');
    const names = new Map(features.flatMap((f) => f.examples.map((x) => [x.exampleId, `${f.name}：${x.then}`])));
    return this.startRun({ purpose: 'regression', checks, names, changeId: snap.changes.active?.changeId ?? null });
  }

  /**
   * 启动一轮运行（回归 / 基线 / 先失败检查）。同一时间只有一轮；异步执行，进度经 SSE 推送。
   * 先失败检查（red_check）的结果不参与例子状态判定（Invariant 7），由投影负责忽略。
   */
  async startRun(req: {
    purpose: RunPurpose;
    checks: CheckSpec[];
    names: Map<string, string>;
    changeId: string | null;
  }): Promise<{ total: number }> {
    if (this.run) throw new HttpError(409, '已有检查在运行');
    this.assertWritable();
    const { checks, names, changeId, purpose } = req;
    if (checks.length === 0) throw new HttpError(400, '没有要运行的检查');

    const controller = new AbortController();
    const config = await this.config();
    const state = {
      runId: null as string | null,
      done: 0,
      total: checks.length,
      current: (names.get(checks[0]!.exampleId) ?? checks[0]!.exampleId) as string | null,
      startedAt: new Date().toISOString(),
      controller,
      promise: Promise.resolve(),
      changeId,
    };
    this.run = state;
    this.lastRunError = null;
    this.pendingCheck = false;
    this.bus.publish('run.started', { ...publicRun(state), changeId });

    state.promise = runChecks({
      projectRoot: this.root,
      ledger: this.ledger,
      checks,
      purpose,
      ...(changeId ? { changeId } : {}),
      config,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'starting') {
          state.runId = p.runId;
          state.done = 0;
          state.current = names.get(checks[0]!.exampleId) ?? null;
        } else if (p.phase === 'check' && p.index !== undefined) {
          state.done = p.index + 1;
          const next = checks[p.index + 1];
          state.current = next ? (names.get(next.exampleId) ?? next.exampleId) : null;
        }
        this.bus.publish('run.progress', { ...publicRun(state), phase: p.phase, exampleId: p.exampleId, status: p.status });
      },
    })
      .then((outcome) => {
        for (const r of outcome.runs) this.bus.publish('ledger.appended', { seq: r.seq, type: r.event.type });
        this.bus.publish('run.finished', { runId: outcome.final.event.runId, valid: outcome.final.event.valid, changeId, purpose });
        this.lastSeenWorkTreeHash = outcome.final.event.endWorkTreeHash;
        this.lastRunResults = { runId: outcome.final.event.runId, purpose, results: outcome.final.event.results };
        this.trackBackground(this.afterRun(outcome.runs.map((r) => r.event)).catch(() => undefined));
      })
      .catch((err: Error) => {
        this.lastRunError = err.message;
        this.bus.publish('run.failed', { message: err.message });
      })
      .finally(() => {
        this.run = null;
        if (this.pendingCheck && !controller.signal.aborted) {
          this.pendingCheck = false;
          void this.startRegression().catch(() => undefined);
        }
      });
    return { total: checks.length };
  }

  /** 最近一轮运行的结果（流程模块用：先失败检查的返回值）。 */
  lastRunResults: { runId: string; purpose: RunPurpose; results: CheckResult[] } | null = null;

  /** 一轮运行结束后：埋点、为进行中的改动更新文件归属（§4.5）。 */
  private async afterRun(runs: EventOf<'run.completed'>[]): Promise<void> {
    const { afterRunHooks } = await import('./flows/hooks.js');
    await afterRunHooks(this, runs);
  }

  cancelRun(): void {
    if (!this.run) throw new HttpError(409, '当前没有在运行的检查');
    this.pendingCheck = false;
    this.run.controller.abort();
  }

  /** 等当前运行（以及运行结束后排队的那一次）结束（测试与优雅退出用）。 */
  async waitForRun(): Promise<void> {
    while (this.run) await this.run.promise;
  }

  // ---- 外部改动（§5.3） ----

  /** 开始监听工作区（chokidar，防抖后调用 onWorkspaceSettled），并定时检查 HEAD。 */
  async startWatching(): Promise<void> {
    if (this.watcher) return;
    this.lastSeenWorkTreeHash = (await this.snapshot()).current.workTreeHash;
    this.watcher = new WorkspaceWatcher(this.root, {
      debounceMs: this.options.watchDebounceMs ?? 2000,
      onSettled: () => this.onWorkspaceSettled(),
      onHeadPoll: () => this.checkHead(),
    });
    await this.watcher.start();
  }

  async stopWatching(): Promise<void> {
    await this.watcher?.stop();
    this.watcher = null;
  }

  /**
   * 工作区静止：工作区真的变了（workTreeHash 变化，过滤掉被忽略文件的噪音）时——
   * 没有进行中的改动 → 建一个外部改动（source: external, track: small，基准为当前 HEAD）；
   * 有进行中的改动 → 变化并入它（不新建）。外部来源的改动在静止后自动进入检查。
   */
  onWorkspaceSettled(): Promise<void> {
    this.settling = this.settling.then(() => this.settleOnce()).catch(() => undefined);
    return this.settling;
  }

  private async settleOnce(): Promise<void> {
    if (this.ledger.state === 'locked') return;
    let snap = await this.snapshot();
    if (snap.current.workTreeHash === this.lastSeenWorkTreeHash) return;
    this.lastSeenWorkTreeHash = snap.current.workTreeHash;
    this.bus.publish('workspace.changed', { workTreeHash: snap.current.workTreeHash });

    if (!snap.changes.active) {
      const baseCommit = await headCommit(this.root);
      const firstObservedWorkTreeHash = snap.current.workTreeHash;
      await this.write(() =>
        this.ledger.transaction(async (tx) => {
          if (activeChangeIdFromLines(tx.report.lines)) return; // 期间刚建了改动：并入它
          await tx.append({
            type: 'change.started',
            changeId: newId('c'),
            track: 'small',
            baseCommit,
            source: 'external',
            description: '外部改动（Cursor 或手写）',
            firstObservedWorkTreeHash,
          });
        }),
      );
      this.bus.publish('change.started', { source: 'external' });
      snap = await this.snapshot();
    }
    const active = snap.changes.active;
    if (active?.source === 'external' && active.phase === 'implementing' && this.options.autoCheckExternal !== false) {
      await this.requestCheck(snap);
    }
  }

  /**
   * HEAD 前进了、却没有对应的 change.merged：有人在 Stagent 之外直接 git commit。
   * 记一条 change.unmanaged_commit，并补跑全量回归（§5.3）。启动时与监听期间定时调用。
   */
  async checkHead(): Promise<boolean> {
    // 授权事务（合并）进行中时 HEAD 的前进是 Stagent 自己造成的。
    if (this.ledger.state === 'locked' || this.authorizer.inProgress) return false;
    const snap = await this.snapshot();
    const known = knownHead(snap.lines);
    const head = await headCommit(this.root);
    if (!known || !head || head === UNBORN_COMMIT || head === known || known === UNBORN_COMMIT) return false;
    if (!(await isAncestor(this.root, known, head))) return false; // 切分支 / 回退不算"前进"
    await this.write(() => this.ledger.append({ type: 'change.unmanaged_commit', fromCommit: known, toCommit: head }));
    await this.requestCheck(await this.snapshot());
    return true;
  }

  private async requestCheck(snap: Snapshot): Promise<void> {
    if (snap.projection.features.every((f) => f.lockedCount === 0)) return;
    if (this.run) {
      this.pendingCheck = true;
      return;
    }
    await this.startRegression().catch(() => undefined);
  }

  // ---- 授权与合并门（§6） ----

  async authorize(req: AuthRequest): Promise<AuthResult> {
    let result: AuthResult;
    try {
      await this.beforeAuthorize(req);
      result = await this.authorizer.authorize(req);
    } catch (err) {
      throw err instanceof AuthError ? new HttpError(err.statusCode, err.message) : err;
    }
    await this.afterAuthorize(req, result).catch(() => undefined);
    return result;
  }

  /** POST /api/changes/:id/merge：合并（服务端合并门 + 授权三段式，免填原因）。 */
  merge(changeId: string): Promise<AuthResult> {
    return this.authorize({ action: 'merge', changeId });
  }

  /** 授权之前：合并类动作先写好文件归属（§4.5：到达可合并前由服务端写 change.files_attributed）。 */
  private async beforeAuthorize(req: AuthRequest): Promise<void> {
    if ((req.action === 'merge' || req.action === 'merge_override') && typeof req.changeId === 'string') {
      const { ensureAttribution } = await import('./flows/map-flow.js');
      await ensureAttribution(this, req.changeId).catch(() => undefined);
    }
  }

  /** 授权完成之后：合并后起草记录卡（§10）。 */
  private async afterAuthorize(req: AuthRequest, result: AuthResult): Promise<void> {
    if (!result.ok) return;
    const { afterAuthHooks } = await import('./flows/hooks.js');
    await afterAuthHooks(this, req, result);
  }

  async abandonPreview(changeId: string) {
    try {
      return await this.authorizer.abandonPreview(changeId);
    } catch (err) {
      throw err instanceof AuthError ? new HttpError(err.statusCode, err.message) : err;
    }
  }

  async dismissDangling(authId: string): Promise<void> {
    this.assertWritable();
    try {
      await this.authorizer.dismissDangling(authId);
    } catch (err) {
      throw err instanceof AuthError ? new HttpError(err.statusCode, err.message) : err;
    }
  }

  /** 「还原锁定文件」：把工作区里被改的锁定检查恢复成快照内容（不需要授权）。 */
  async restoreLockedCheck(exampleId: string): Promise<void> {
    this.assertWritable();
    const x = (await this.features()).flatMap((f) => f.examples).find((e) => e.exampleId === exampleId);
    if (!x) throw new HttpError(404, `例子 ${exampleId} 不是锁定例子`);
    await restoreLockedCheck(this.root, x.checkPath, x.checkHash);
    this.bus.publish('workspace.changed', { restored: x.checkPath });
  }

  /**
   * 「授权修改锁定例子」之后重新锁定（解锁 → 改 → 重锁 → 自动回归）：
   * 只接受经 modify_locked 授权解锁的例子；可同时更新情况 / 操作 / 期望。
   */
  async relockExample(exampleId: string, input: Record<string, unknown>): Promise<void> {
    this.assertWritable();
    const snap = await this.snapshot();
    const grantedAction = new Map<string, AuthAction>();
    let draft: EventOf<'example.drafted'> | null = null;
    let unlockedBy: string | null = null;
    for (const { event: e } of snap.lines) {
      if (e.type === 'auth.granted') grantedAction.set(e.authId, e.action);
      else if (e.type === 'example.drafted' && e.exampleId === exampleId) draft = e;
      else if (e.type === 'example.locked' && e.exampleId === exampleId) unlockedBy = null;
      else if (e.type === 'example.unlocked' && e.exampleId === exampleId) unlockedBy = e.authId ?? null;
    }
    if (!draft || !draft.checkPath) throw new HttpError(404, `例子 ${exampleId} 不存在`);
    if (!unlockedBy || grantedAction.get(unlockedBy) !== 'modify_locked') {
      throw new HttpError(409, '只有经「授权修改锁定例子」解锁的例子才能重新锁定');
    }
    if (!snap.projection.features.some((f) => f.featureId === draft!.featureId)) throw new HttpError(409, '例子所属功能已退役');
    const text = (k: 'given' | 'when' | 'then') =>
      typeof input[k] === 'string' && (input[k] as string).trim() ? (input[k] as string).trim() : draft![k];
    const next = { given: text('given'), when: text('when'), then: text('then') };
    let checkHash: string;
    try {
      checkHash = await snapshotForRelock(this.root, draft.checkPath);
    } catch {
      throw new HttpError(400, `检查文件 ${draft.checkPath} 不存在`);
    }
    const changeId = snap.changes.active?.changeId;
    const { checkPath, featureId, kind } = draft;
    await this.write(() =>
      this.ledger.transaction(async (tx) => {
        await tx.append({ type: 'example.drafted', exampleId, featureId, ...next, kind, checkPath, ...(changeId ? { changeId } : {}) });
        await tx.append({ type: 'example.locked', exampleId, checkPath, checkHash, by: 'user', ...(changeId ? { changeId } : {}) });
      }),
    );
    await this.requestCheck(await this.snapshot());
  }

  // ---- 账本 ----

  /** "我确认，接受当前状态"：写 ledger.integrity_override。 */
  async acceptLedger(reason: string): Promise<void> {
    try {
      assertReason(reason);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (this.ledger.state !== 'locked') await this.ledger.verify();
    if (this.ledger.state !== 'locked') throw new HttpError(409, '账本未被修改，无需接受当前状态');
    const line = await this.ledger.acceptCurrentState(reason);
    this.bus.publish('ledger.appended', { seq: line.seq, type: line.event.type });
  }

  /** POST /api/ledger/recover（§4.1、M6）。 */
  async recoverLedger(mode: unknown, reason: string): Promise<void> {
    if (mode === 'accept_current') return this.acceptLedger(reason);
    if (mode === 'establish_trust') {
      try {
        const line = await this.ledger.establishTrust(reason.trim() || '用户确认当前账本可信');
        this.bus.publish('ledger.appended', { seq: line.seq, type: line.event.type });
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
      return;
    }
    if (mode === 'from_git') {
      try {
        const line = await this.ledger.restoreFromGit(this.root, reason.trim() || '从 git 历史恢复');
        await cleanOrphanSnapshots(this.root, this.ledger.events());
        this.bus.publish('ledger.appended', { seq: line.seq, type: line.event.type });
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
      return;
    }
    throw new HttpError(400, 'mode 必须是 accept_current、establish_trust 或 from_git');
  }

  /** 「修改启动命令」：写回 .stagent/config.json 的 devServer（config 在 workTreeHash 范围内，证据会过期——这是预期行为）。 */
  async setDevServer(body: { command?: unknown; url?: unknown }): Promise<{ ok: true }> {
    this.assertWritable();
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!command || !/^https?:\/\//.test(url)) throw new HttpError(400, '请填写启动命令和以 http(s):// 开头的健康检查地址');
    const path = join(this.root, '.stagent', 'config.json');
    const raw = JSON.parse(await readFile(path, 'utf8').catch(() => '{}')) as Record<string, unknown>;
    const prev = (raw.devServer ?? {}) as Record<string, unknown>;
    raw.devServer = { ...prev, command, url };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify(raw, null, 2) + '\n');
    return { ok: true };
  }

  // ---- 内部 ----

  async activeChange(changeId: string): Promise<ChangeView> {
    this.assertWritable();
    const { changes } = await this.snapshot();
    const c = changes.changes.find((x) => x.changeId === changeId);
    if (!c) throw new HttpError(404, `改动 ${changeId} 不存在`);
    if (changes.active?.changeId !== changeId) throw new HttpError(409, `改动已${c.phaseLabel}，不能再操作`);
    return c;
  }

  assertWritable(): void {
    if (this.ledger.state === 'locked') throw new HttpError(423, '账本被修改，写操作已禁用');
  }

  async write<T>(fn: () => Promise<T>): Promise<T> {
    this.assertWritable();
    try {
      const before = this.ledger.report.nextSeq;
      const result = await fn();
      this.bus.publish('ledger.appended', { fromSeq: before, toSeq: this.ledger.report.nextSeq - 1 });
      return result;
    } catch (err) {
      if (err instanceof LedgerLockedError) {
        this.bus.publish('ledger.locked', { brokenLinks: err.report.brokenLinks });
        throw new HttpError(423, '账本被修改，写操作已禁用');
      }
      throw err;
    }
  }
}

async function currentBranch(root: string): Promise<string | null> {
  try {
    const b = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
    return b || null;
  } catch {
    return null;
  }
}

function publicTask(t: AgentTaskView): AgentTaskView {
  return {
    kind: t.kind,
    label: t.label,
    changeId: t.changeId,
    line: t.line,
    log: t.log.slice(-200),
    startedAt: t.startedAt,
    sessionId: t.sessionId,
  };
}

function publicRun(r: RunProgressView): RunProgressView {
  return { runId: r.runId, done: r.done, total: r.total, current: r.current, startedAt: r.startedAt };
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export function checkPathInput(p: string): string {
  if (!p) throw new HttpError(400, '缺少检查文件路径');
  const n = normalize(p);
  const prefix = normalize(CHECKS_RELATIVE_DIR) + sep;
  if (isAbsolute(n) || !n.startsWith(prefix)) throw new HttpError(400, '检查文件必须在 .stagent/checks/ 下');
  return n.split(sep).join('/');
}
