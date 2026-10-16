/**
 * 改动投影与状态机（规格 §5.0–§5.4）。纯函数：阶段只由服务端从事件推导，
 * Claude Code 和前端都不能直接设置状态。
 *
 * 阶段推导（对每个改动，按顺序取第一条成立的）：
 *
 * | 条件                                                         | 阶段       |
 * |--------------------------------------------------------------|------------|
 * | 有 change.merged / change.abandoned                           | 已合并 / 已放弃 |
 * | 本改动的检查正在运行                                           | 检查中     |
 * | 新功能档，且本改动还没有锁定例子、或还有未锁定的草稿            | 确认例子（草稿已跑过先失败检查 → 先失败检查） |
 * | 本改动还没有运行过检查                                         | 实现中     |
 * | 最近一次运行之后工作区又变了（交给修复 / 外部改动继续）          | 实现中     |
 * | 外观被确认为不满意（运行之后的 visual.confirmed ok=false）       | 实现中     |
 * | 有失败、未验证的锁定例子，或运行无效                            | 被阻止     |
 * | 本改动锁定的外观例子还没在运行后被确认                          | 待你确认外观 |
 * | 其余                                                          | 可合并     |
 *
 * 同一时间最多一个进行中的改动（未合并且未放弃）。
 */
import type { EventOf, IsoTime, LedgerLine, Sha256Hex, Track } from '../ledger/types.js';
import type { CurrentWorkTree, ExampleView, LedgerProjection } from '../projection/projection.js';

export type ChangePhase =
  | 'confirm_examples'
  | 'red_check'
  | 'implementing'
  | 'checking'
  | 'blocked'
  | 'awaiting_visual'
  | 'mergeable'
  | 'merged'
  | 'abandoned';

export const PHASE_LABELS: Record<ChangePhase, string> = {
  confirm_examples: '确认例子',
  red_check: '先失败检查',
  implementing: '实现中',
  checking: '检查中',
  blocked: '被阻止',
  awaiting_visual: '待你确认外观',
  mergeable: '可合并',
  merged: '已合并',
  abandoned: '已放弃',
};

/** 抽屉进度条：①确认例子 → ②实现 → ③检查 → ④确认并合并。 */
export const PHASE_STEP: Record<ChangePhase, 1 | 2 | 3 | 4> = {
  confirm_examples: 1,
  red_check: 1,
  implementing: 2,
  checking: 3,
  blocked: 3,
  awaiting_visual: 4,
  mergeable: 4,
  merged: 4,
  abandoned: 2,
};

export const TERMINAL_PHASES: ReadonlySet<ChangePhase> = new Set(['merged', 'abandoned']);

export interface TrackChange {
  from: Track;
  to: Track;
  at: IsoTime;
  reason?: string;
}

export interface ChangeView {
  changeId: string;
  description: string;
  source: EventOf<'change.started'>['source'];
  track: Track;
  /** 创建时的档位。 */
  initialTrack: Track;
  trackHistory: TrackChange[];
  baseCommit: string;
  firstObservedWorkTreeHash?: Sha256Hex;
  startedAt: IsoTime;
  phase: ChangePhase;
  phaseLabel: string;
  step: 1 | 2 | 3 | 4;
  /** 本改动起草的例子（含已锁定）。 */
  draftedExampleIds: string[];
  lockedExampleIds: string[];
  pendingDraftIds: string[];
  /** 待锁定草稿的内容，供「确认例子」决策卡展示。 */
  pendingDrafts: PendingDraft[];
  planId?: string;
  stepId?: string;
  /** 本改动意图触及的功能（§4.5「超出本功能的改动」）：change.started.targetFeatureIds + 本改动新建的功能。 */
  targetFeatureIds: string[];
  /** 本改动起草时新建的功能。 */
  createdFeatureIds: string[];
  /** AI 回报（仅声称）：round 0 为实现，n 为第 n 轮修复。 */
  claims: { text: string; at: IsoTime; round: number; malformed: boolean }[];
  /** 已经做过的修复轮数。 */
  fixRounds: number;
  /** Claude Code 会话中断（服务重启时有进行中的 AI 任务）。之后又有回报或运行则清除。 */
  interrupted: { reason: string; at: IsoTime } | null;
  /** 等你确认截图的外观例子（运行之后还没确认）。 */
  visualPending: { exampleId: string; then: string; runId: string; screenshot?: string }[];
  lastRun: { runId: string; at: IsoTime; valid: boolean; fresh: boolean } | null;
  /** 被阻止 / 等待的原因（给人看的句子），最严重的在前。 */
  blockers: string[];
  /** 本改动期间检测到的、未经 Stagent 合并的提交。 */
  unmanagedCommits: { fromCommit: string; toCommit: string; at: IsoTime }[];
  endedAt: IsoTime | null;
}

export interface PendingDraft {
  exampleId: string;
  featureId: string;
  given: string;
  when: string;
  then: string;
  kind: 'behavior' | 'visual';
  checkPath?: string;
  summary?: string;
  baseline?: boolean;
  /** 最近一次先失败检查（purpose: red_check）对这条草稿的结果；checkHash 是当时所跑内容的 sha256。 */
  redCheck: { runId: string; status: string; checkHash: string; logPath: string; at: IsoTime } | null;
  /** 「确认行为已存在」的豁免（只对同一内容有效）。 */
  waiver: { reason: string; checkHash: string } | null;
}

export interface ChangeContext {
  current: CurrentWorkTree;
  projection: LedgerProjection;
  /** 正在为哪个改动运行检查（运行时状态）。 */
  runningChangeId: string | null;
}

export interface ChangesProjection {
  changes: ChangeView[];
  active: ChangeView | null;
}

interface Acc {
  started: EventOf<'change.started'>;
  at: IsoTime;
  track: Track;
  trackHistory: TrackChange[];
  drafted: string[];
  locked: string[];
  runs: { event: EventOf<'run.completed'>; at: IsoTime; seq: number }[];
  redCheckDrafts: Set<string>;
  unmanaged: ChangeView['unmanagedCommits'];
  claims: ChangeView['claims'];
  interrupted: { reason: string; at: IsoTime; seq: number } | null;
  lastActivitySeq: number;
  startSeq: number;
  createdFeatures: string[];
  ended: { phase: 'merged' | 'abandoned'; at: IsoTime } | null;
}

export function projectChanges(lines: readonly LedgerLine[], ctx: ChangeContext): ChangesProjection {
  const changes = new Map<string, Acc>();
  const visualConfirms = new Map<string, { ok: boolean; seq: number }>();
  const lockedKind = new Map<string, EventOf<'example.drafted'>['kind']>();
  const draftEvents = new Map<string, EventOf<'example.drafted'>>();
  const redResults = new Map<string, NonNullable<PendingDraft['redCheck']>>();
  const waivers = new Map<string, { reason: string; checkHash: string }>();
  const discarded = new Set<string>();
  const featureCreatedSeq = new Map<string, number>();
  let activeId: string | null = null;

  for (const { event: e, at, seq } of lines) {
    switch (e.type) {
      case 'change.started':
        changes.set(e.changeId, {
          started: e,
          at,
          track: e.track,
          trackHistory: [],
          drafted: [],
          locked: [],
          runs: [],
          redCheckDrafts: new Set(),
          unmanaged: [],
          ended: null,
          claims: [],
          interrupted: null,
          lastActivitySeq: seq,
          startSeq: seq,
          createdFeatures: [],
        });
        activeId = e.changeId;
        break;
      case 'feature.created':
        featureCreatedSeq.set(e.featureId, seq);
        break;
      case 'example.red_waived':
        waivers.set(e.exampleId, { reason: e.reason, checkHash: e.checkHash });
        break;
      case 'example.discarded':
        discarded.add(e.exampleId);
        break;
      case 'claim.reported': {
        const c = changes.get(e.changeId);
        if (c && (!e.exampleId || !c.claims.some((x) => x.text === e.text && x.round === (e.round ?? 0)))) {
          c.claims.push({ text: e.text, at, round: e.round ?? 0, malformed: e.malformed === true });
          c.lastActivitySeq = seq;
        }
        break;
      }
      case 'change.interrupted': {
        const c = changes.get(e.changeId);
        if (c) c.interrupted = { reason: e.reason, at, seq };
        break;
      }
      case 'change.track_upgraded':
      case 'change.track_downgraded': {
        const c = changes.get(e.changeId);
        if (!c) break;
        const to: Track = e.type === 'change.track_upgraded' ? 'feature' : 'small';
        c.trackHistory.push({ from: c.track, to, at, ...('reason' in e && e.reason ? { reason: e.reason } : {}) });
        c.track = to;
        break;
      }
      case 'example.drafted':
        lockedKind.set(e.exampleId, e.kind);
        draftEvents.set(e.exampleId, e);
        discarded.delete(e.exampleId);
        if (e.changeId) {
          const c = changes.get(e.changeId);
          if (c && !c.drafted.includes(e.exampleId)) c.drafted.push(e.exampleId);
          // 起草时同一事务里新建的功能（feature.created 紧挨在前）算本改动新建的功能。
          const fseq = featureCreatedSeq.get(e.featureId);
          if (c && fseq !== undefined && fseq > c.startSeq && !c.createdFeatures.includes(e.featureId)) {
            c.createdFeatures.push(e.featureId);
          }
        }
        break;
      case 'example.locked':
        if (e.changeId) changes.get(e.changeId)?.locked.push(e.exampleId);
        break;
      case 'run.completed': {
        if (!e.changeId) break;
        const c = changes.get(e.changeId);
        if (!c) break;
        if (e.purpose === 'red_check') {
          for (const id of Object.keys(e.snapshots)) c.redCheckDrafts.add(id);
          for (const r of e.results) {
            redResults.set(r.exampleId, { runId: e.runId, status: r.status, checkHash: r.checkSnapshotId ?? e.snapshots[r.exampleId] ?? '', logPath: r.logPath, at });
          }
        } else {
          c.runs.push({ event: e, at, seq });
          c.lastActivitySeq = seq;
        }
        break;
      }
      case 'visual.confirmed':
        visualConfirms.set(e.exampleId, { ok: e.ok, seq });
        break;
      case 'change.unmanaged_commit':
        if (activeId) changes.get(activeId)?.unmanaged.push({ fromCommit: e.fromCommit, toCommit: e.toCommit, at });
        break;
      case 'change.merged':
      case 'change.abandoned': {
        const c = changes.get(e.changeId);
        if (c && !c.ended) c.ended = { phase: e.type === 'change.merged' ? 'merged' : 'abandoned', at };
        if (activeId === e.changeId) activeId = null;
        break;
      }
      default:
        break;
    }
  }

  const examples = new Map(ctx.projection.features.flatMap((f) => f.examples.map((x) => [x.exampleId, { x, feature: f.name }])));
  for (const c of changes.values()) c.drafted = c.drafted.filter((id) => !discarded.has(id) || c.locked.includes(id));
  const views = [...changes.values()].map((c) =>
    judgeChange(c, ctx, examples, visualConfirms, lockedKind, draftEvents, { redResults, waivers }),
  );
  const active = views.find((v) => v.changeId === activeId && !TERMINAL_PHASES.has(v.phase)) ?? null;
  return { changes: views, active };
}

function judgeChange(
  c: Acc,
  ctx: ChangeContext,
  examples: Map<string, { x: ExampleView; feature: string }>,
  visualConfirms: Map<string, { ok: boolean; seq: number }>,
  kinds: Map<string, EventOf<'example.drafted'>['kind']>,
  draftEvents: Map<string, EventOf<'example.drafted'>>,
  red: { redResults: Map<string, NonNullable<PendingDraft['redCheck']>>; waivers: Map<string, { reason: string; checkHash: string }> },
): ChangeView {
  const lockedSet = new Set(c.locked);
  const pendingDraftIds = c.drafted.filter((id) => !lockedSet.has(id));
  const last = c.runs[c.runs.length - 1] ?? null;
  const fresh =
    last !== null &&
    last.event.endWorkTreeHash === ctx.current.workTreeHash &&
    last.event.workTreeHashSpec === ctx.current.workTreeHashSpec;

  const blockers: string[] = [];
  const phase = ((): ChangePhase => {
    if (c.ended) return c.ended.phase;
    if (ctx.runningChangeId === c.started.changeId) return 'checking';
    if (c.track === 'feature' && (c.locked.length === 0 || pendingDraftIds.length > 0)) {
      if (pendingDraftIds.length > 0 && pendingDraftIds.every((id) => c.redCheckDrafts.has(id) || red.waivers.has(id))) {
        const bad = pendingDraftIds.filter((id) => !red.waivers.has(id) && red.redResults.get(id)?.status !== 'failed');
        blockers.push(
          bad.length
            ? `先失败检查：${bad.length} 条检查在实现前没有失败，没测到新行为——重写、确认行为已存在（填原因）或删掉`
            : `先失败检查合格：确认并锁定 ${pendingDraftIds.length} 个例子`,
        );
        return 'red_check';
      }
      blockers.push(
        c.drafted.length === 0
          ? '新功能档：先起草验收例子'
          : `新功能档：还有 ${pendingDraftIds.length} 个例子草稿等你确认并锁定`,
      );
      return 'confirm_examples';
    }
    if (!last) {
      blockers.push('还没有检查：改完后点「开始检查」');
      return 'implementing';
    }
    if (!fresh) {
      blockers.push('上次检查之后代码又有改动，需要重新检查');
      return 'implementing';
    }
    const rejected = c.locked.filter((id) => {
      const v = visualConfirms.get(id);
      return v !== undefined && v.seq > last.seq && !v.ok;
    });
    if (rejected.length) {
      blockers.push(`${rejected.length} 个外观例子你确认为不满意，回到实现`);
      return 'implementing';
    }
    if (!last.event.valid) blockers.push('检查运行期间代码有变化，结果无效');
    for (const { x, feature } of examples.values()) {
      if (x.state === 'failed' && !x.knownInconsistent) blockers.push(`「${feature}」的例子失败：${x.then}`);
    }
    for (const { x, feature } of examples.values()) {
      if (x.state === 'unverified') blockers.push(`「${feature}」的例子未验证（${x.explanation}）`);
    }
    if (blockers.length) return 'blocked';
    const visualPending = c.locked.filter((id) => {
      if (kinds.get(id) !== 'visual') return false;
      const v = visualConfirms.get(id);
      return !(v && v.seq > last.seq && v.ok);
    });
    if (visualPending.length) {
      blockers.push(`${visualPending.length} 个外观例子等你确认截图`);
      return 'awaiting_visual';
    }
    return 'mergeable';
  })();

  const lastRunEvent = last?.event ?? null;
  const visualPending =
    phase === 'awaiting_visual' && lastRunEvent
      ? c.locked
          .filter((id) => kinds.get(id) === 'visual')
          .filter((id) => {
            const v = visualConfirms.get(id);
            return !(v && last && v.seq > last.seq && v.ok);
          })
          .map((id) => {
            const shot = lastRunEvent.results.find((r) => r.exampleId === id)?.screenshot;
            return { exampleId: id, then: draftEvents.get(id)?.then ?? '', runId: lastRunEvent.runId, ...(shot ? { screenshot: shot } : {}) };
          })
      : [];
  const interrupted = c.interrupted && c.interrupted.seq > c.lastActivitySeq && !c.ended ? { reason: c.interrupted.reason, at: c.interrupted.at } : null;

  return {
    changeId: c.started.changeId,
    description: c.started.description ?? '',
    source: c.started.source,
    track: c.track,
    initialTrack: c.started.track,
    trackHistory: c.trackHistory,
    baseCommit: c.started.baseCommit,
    ...(c.started.firstObservedWorkTreeHash ? { firstObservedWorkTreeHash: c.started.firstObservedWorkTreeHash } : {}),
    startedAt: c.at,
    phase,
    phaseLabel: PHASE_LABELS[phase],
    step: PHASE_STEP[phase],
    draftedExampleIds: c.drafted,
    lockedExampleIds: c.locked,
    pendingDraftIds,
    pendingDrafts: pendingDraftIds.flatMap((id): PendingDraft[] => {
      const d = draftEvents.get(id);
      return d
        ? [
            {
              exampleId: id,
              featureId: d.featureId,
              given: d.given,
              when: d.when,
              then: d.then,
              kind: d.kind,
              ...(d.checkPath ? { checkPath: d.checkPath } : {}),
              ...(d.summary ? { summary: d.summary } : {}),
              ...(d.baseline ? { baseline: true } : {}),
              redCheck: red.redResults.get(id) ?? null,
              waiver: red.waivers.get(id) ?? null,
            },
          ]
        : [];
    }),
    ...(c.started.planId ? { planId: c.started.planId } : {}),
    ...(c.started.stepId ? { stepId: c.started.stepId } : {}),
    targetFeatureIds: [...new Set([...(c.started.targetFeatureIds ?? []), ...c.createdFeatures])],
    createdFeatureIds: c.createdFeatures,
    claims: c.claims,
    fixRounds: c.claims.reduce((m, x) => Math.max(m, x.round), 0),
    interrupted,
    visualPending,
    lastRun: last ? { runId: last.event.runId, at: last.at, valid: last.event.valid, fresh } : null,
    blockers,
    unmanagedCommits: c.unmanaged,
    endedAt: c.ended?.at ?? null,
  };
}

/**
 * Stagent 已知的最近一个 HEAD：用来判断"有人在 Stagent 之外直接 git commit"。
 * 取 change.started.baseCommit、change.merged.mergeCommit、change.unmanaged_commit.toCommit 中最后出现的；
 * 都没有时退回到最近一次运行的 endCommit；仍没有则返回 null（新项目，不做判断）。
 */
export function knownHead(lines: readonly LedgerLine[]): string | null {
  let known: string | null = null;
  let lastRunCommit: string | null = null;
  for (const { event: e } of lines) {
    if (e.type === 'change.started') known = e.baseCommit;
    else if (e.type === 'change.merged') known = e.mergeCommit;
    else if (e.type === 'change.unmanaged_commit') known = e.toCommit;
    else if (e.type === 'run.completed') lastRunCommit = e.endCommit;
  }
  return known ?? lastRunCommit;
}

/** 只看事件就能判断的进行中改动（未合并、未放弃的最近一个），用于在账本写锁内做互斥检查。 */
export function activeChangeIdFromLines(lines: readonly LedgerLine[]): string | null {
  let active: string | null = null;
  for (const { event: e } of lines) {
    if (e.type === 'change.started') active = e.changeId;
    else if ((e.type === 'change.merged' || e.type === 'change.abandoned') && e.changeId === active) active = null;
  }
  return active;
}
