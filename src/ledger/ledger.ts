/**
 * 账本服务（规格 §4.1）：.stagent/ledger/events.jsonl 只追加写入。
 *
 * - 打开时校验整条链；每次写入前在写锁内重新读盘校验（规格："服务启动时和每次写入前都会校验整条链"）。
 * - 链断裂 → 只读锁定，写入抛 LedgerLockedError；只有 acceptCurrentState() 能写 ledger.integrity_override 解除。
 * - 写锁是进程内互斥锁，transaction() 让授权三段式（src/server/auth.ts）的每一段在同一把锁内连续追加；事务内调用 append() 可重入。
 *
 * M6：每次追加都走仓库外链头锚点的原子写入协议（src/ledger/anchor.ts）：先写 head.tmp → 追加事件 → rename 为 head；
 * 打开与每次写入前按启动规则 3–7 核对锚点：崩溃恢复自动完成，head 缺失要你确认信任（TOFU），对不上则锁定。
 * 环境变量 STAGENT_ANCHOR=off 或 options.anchor=false 时不启用锚点（只校验链内一致性）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, truncate } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lineHash, sha256Hex } from './hash.js';
import { Mutex } from './mutex.js';
import { GENESIS_HASH, LEDGER_VERSION, type Event, type LedgerLine } from './types.js';
import { verifyLedger, type VerifyReport } from './verify.js';
import { Anchor, type AnchorCheck } from './anchor.js';
import { git } from '../git/git.js';

export const LEDGER_RELATIVE_PATH = join('.stagent', 'ledger', 'events.jsonl');

/** 授权与 override 原因的最短长度（§6：至少 4 个字）。 */
export const MIN_REASON_LENGTH = 4;

export class LedgerLockedError extends Error {
  override name = 'LedgerLockedError';
  constructor(
    readonly report: VerifyReport,
    message?: string,
  ) {
    super(message ?? `账本被修改（断链行：${report.brokenLinks.map((b) => b.seq).join(', ')}），已进入只读锁定`);
  }
}

/** 外部锚点的对外状态（overview / 交付报告用）。 */
export interface AnchorStatus {
  enabled: boolean;
  state: 'ok' | 'trust_needed' | 'conflict' | 'disabled';
  detail?: string;
  headPath?: string;
}

export class LedgerMissingError extends Error {
  override name = 'LedgerMissingError';
  constructor(readonly path: string) {
    super(`未找到账本 ${path}，请先运行 stagent init`);
  }
}

export interface LedgerOptions {
  /** 时间来源，测试可注入。 */
  now?: () => Date;
  /** 是否启用 ~/.stagent 链头锚点（M6）。默认启用，STAGENT_ANCHOR=off 时关闭。 */
  anchor?: boolean;
}

function anchorEnabled(options: LedgerOptions): boolean {
  return options.anchor ?? process.env.STAGENT_ANCHOR !== 'off';
}

/** 事务句柄：在写锁内连续追加。 */
export interface LedgerTx {
  append(event: Event): Promise<LedgerLine>;
  readonly report: VerifyReport;
}

export class Ledger {
  private readonly mutex = new Mutex();
  private readonly txScope = new AsyncLocalStorage<LedgerTx>();
  private readonly now: () => Date;
  private current: VerifyReport;
  private anchor: Anchor | null = null;
  private anchorCheck: AnchorCheck | null = null;

  private constructor(
    readonly path: string,
    report: VerifyReport,
    private readonly options: LedgerOptions,
  ) {
    this.current = report;
    this.now = options.now ?? (() => new Date());
    if (anchorEnabled(options) && report.meta?.projectId) this.anchor = Anchor.forProject(report.meta.projectId);
  }

  static pathFor(projectRoot: string): string {
    return join(projectRoot, LEDGER_RELATIVE_PATH);
  }

  /**
   * 创建账本（已存在则直接打开）。首行写入 ledger.meta。
   * 返回的账本可能处于锁定状态（已存在且被篡改时），调用方据 state 判断。
   */
  static async init(projectRoot: string, options: LedgerOptions & { projectId?: string } = {}): Promise<Ledger> {
    const path = Ledger.pathFor(projectRoot);
    await mkdir(dirname(path), { recursive: true });
    const existing = await readIfExists(path);
    if (existing === null || verifyLedger(existing).status === 'empty') {
      const now = options.now ?? (() => new Date());
      const at = now().toISOString();
      const event: Event = {
        type: 'ledger.meta',
        ledgerVersion: LEDGER_VERSION,
        projectId: options.projectId ?? randomUUID(),
        createdAt: at,
      };
      const line = buildLine(0, at, event, GENESIS_HASH);
      // 新账本：锚点与 meta 行一起建立（不需要 TOFU）。
      const anchor = anchorEnabled(options) ? Anchor.forProject(event.projectId) : null;
      await anchor?.writeIntent(line.hash);
      // 'wx' 防止并发 init 互相覆盖；空文件（含仅有半行）则截断重写。
      if (existing === null) await writeNew(path, serialize(line));
      else {
        await truncate(path, 0);
        await appendBytes(path, serialize(line));
      }
      await anchor?.commit(line.hash);
    }
    return Ledger.open(projectRoot, options);
  }

  /** 打开并校验。版本不符抛 LedgerVersionError；断链不抛错，返回锁定状态的只读账本。 */
  static async open(projectRoot: string, options: LedgerOptions = {}): Promise<Ledger> {
    const path = Ledger.pathFor(projectRoot);
    const bytes = await readIfExists(path);
    if (bytes === null) throw new LedgerMissingError(path);
    const ledger = new Ledger(path, verifyLedger(bytes), options);
    await ledger.mutex.runExclusive(() => ledger.checkAnchor());
    return ledger;
  }

  /** 链断裂，或外部锚点待确认 / 对不上时都是只读锁定。 */
  get state(): 'ok' | 'locked' {
    if (this.current.status === 'locked') return 'locked';
    const a = this.anchorCheck?.state;
    return a === 'trust_needed' || a === 'conflict' ? 'locked' : 'ok';
  }

  get anchorStatus(): AnchorStatus {
    if (!this.anchor) return { enabled: false, state: 'disabled' };
    const c = this.anchorCheck;
    const state = !c || c.state === 'ok' || c.state === 'recovered' ? 'ok' : c.state;
    return { enabled: true, state, ...(c?.detail ? { detail: c.detail } : {}), headPath: this.anchor.headPath };
  }

  /** 最近一次校验的报告（打开、写入或 verify() 时更新）。 */
  get report(): VerifyReport {
    return this.current;
  }

  get projectId(): string | null {
    return this.current.meta?.projectId ?? null;
  }

  /** 已解析的全部行（锁定时只读展示，含断链行）。 */
  lines(): readonly LedgerLine[] {
    return this.current.lines;
  }

  events(): Event[] {
    return this.current.lines.map((l) => l.event);
  }

  /** 重新读盘校验整条链。 */
  async verify(): Promise<VerifyReport> {
    return this.mutex.runExclusive(() => this.reload());
  }

  /** 追加一个事件。锁定时抛 LedgerLockedError。 */
  async append(event: Event): Promise<LedgerLine> {
    const tx = this.txScope.getStore();
    if (tx) return tx.append(event);
    return this.transaction((t) => t.append(event));
  }

  /**
   * 在写锁内执行 fn；fn 内的 append 依次落盘。
   * 进入时校验整条链，锁定则不执行 fn 直接抛 LedgerLockedError。
   */
  async transaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    if (this.txScope.getStore()) throw new Error('账本事务不支持嵌套');
    return this.mutex.runExclusive(async () => {
      const report = await this.reload();
      if (report.status === 'locked') throw new LedgerLockedError(report);
      if (report.meta === null) throw new LedgerMissingError(this.path);
      this.assertAnchorWritable(report);
      await this.repairTail(report);
      let open = true;
      const tx: LedgerTx = {
        append: async (event) => {
          if (!open) throw new Error('账本事务已结束，不能再追加');
          return this.writeEvent(event);
        },
        get report() {
          return report;
        },
      };
      try {
        return await this.txScope.run(tx, () => fn(tx));
      } finally {
        open = false;
      }
    });
  }

  /**
   * "我确认，接受当前状态"：在锁定账本末尾写入 ledger.integrity_override，
   * 记录此前全部字节的 sha256 与当前断链行号。账本未锁定时报错（没有可接受的断链）。
   */
  async acceptCurrentState(reason: string): Promise<LedgerLine> {
    assertReason(reason);
    if (this.txScope.getStore()) throw new Error('不能在账本事务内接受当前状态');
    return this.mutex.runExclusive(async () => {
      const report = await this.reload();
      // 链断裂，或（M6）链合法但与锚点冲突：都可以由你接受当前状态（报告里显式标注，不表述为"恢复"）。
      const anchorConflict = report.status !== 'locked' && this.anchorCheck?.state === 'conflict';
      if (report.status !== 'locked' && !anchorConflict) throw new Error('账本未被修改，无需接受当前状态');
      await this.repairTail(report);
      const prefix = await readFile(this.path);
      const event: Event = {
        type: 'ledger.integrity_override',
        prefixSha256: sha256Hex(prefix),
        brokenLinks: report.brokenLinks.map((b) => b.seq),
        reason: anchorConflict ? `${reason.trim()}（外部锚点冲突：${this.anchorCheck?.detail ?? ''}）` : reason.trim(),
        by: 'user',
      };
      const line = buildLine(report.nextSeq, this.now().toISOString(), event, report.lastHash);
      await this.anchor?.writeIntent(line.hash);
      await appendBytes(this.path, serialize(line));
      await this.anchor?.commit(line.hash);
      this.anchorCheck = this.anchor ? { state: 'ok', detail: '', head: line.hash } : null;
      return this.afterWrite(line, await this.reload());
    });
  }

  /** TOFU（规则 6）：head 缺失时由你确认信任当前账本，写 ledger.trust_established 并建立 head。 */
  async establishTrust(detail = '用户确认当前账本可信'): Promise<LedgerLine> {
    return this.mutex.runExclusive(async () => {
      const report = await this.reload();
      if (!this.anchor) throw new Error('未启用外部锚点');
      if (report.status === 'locked') throw new LedgerLockedError(report);
      if (this.anchorCheck?.state !== 'trust_needed') throw new Error('本机已有链头锚点，无需重新确认信任');
      await this.repairTail(report);
      const event: Event = { type: 'ledger.trust_established', head: report.lastHash, detail, by: 'user' };
      const line = buildLine(report.nextSeq, this.now().toISOString(), event, report.lastHash);
      await this.anchor.writeIntent(line.hash);
      await appendBytes(this.path, serialize(line));
      await this.anchor.commit(line.hash);
      this.anchorCheck = { state: 'ok', detail: '', head: line.hash };
      return this.afterWrite(line, await this.reload());
    });
  }

  /**
   * 从 git 历史恢复（规则 7 选项一）：在提交过的 events.jsonl 版本里，优先取最近一条包含本机锚点的合法链，
   * 没有则取最近一条合法链；连同 snapshots/ 一起恢复，追加 ledger.restored 并把 head 前移到新链头。
   */
  async restoreFromGit(projectRoot: string, detail = '从 git 历史恢复'): Promise<LedgerLine> {
    return this.mutex.runExclusive(async () => {
      const rel = '.stagent/ledger/events.jsonl';
      const commits = (await git(projectRoot, ['log', '--format=%H', '-n', '50', '--', rel]).catch(() => '')).split('\n').filter(Boolean);
      const head = (await this.anchor?.readHead()) ?? null;
      const before = this.current.nextSeq;
      // 先找包含本机锚点的版本（锚点见证过的历史）；没有的话取最近一个合法版本（锚点之后的事件尚未提交）。
      const candidates: { commit: string; blob: string; report: VerifyReport }[] = [];
      for (const commit of commits) {
        const blob = await git(projectRoot, ['show', `${commit}:${rel}`]).catch(() => null);
        if (blob === null) continue;
        let report: VerifyReport;
        try {
          report = verifyLedger(Buffer.from(blob));
        } catch {
          continue;
        }
        if (report.status !== 'ok' || report.meta?.projectId !== this.current.meta?.projectId) continue;
        candidates.push({ commit, blob, report });
      }
      const chosen = candidates.find((c) => head && c.report.lines.some((l) => l.hash === head)) ?? candidates[0];
      if (chosen) {
        const { commit, blob, report: restored } = chosen;
        await writeFileAtomic(this.path, Buffer.from(blob));
        await git(projectRoot, ['checkout', commit, '--', '.stagent/ledger/snapshots']).catch(() => undefined);
        const event: Event = {
          type: 'ledger.restored',
          fromCommit: commit,
          discardedLines: Math.max(0, before - restored.nextSeq),
          detail,
          by: 'user',
        };
        const line = buildLine(restored.nextSeq, this.now().toISOString(), event, restored.lastHash);
        await this.anchor?.writeIntent(line.hash);
        await appendBytes(this.path, serialize(line));
        await this.anchor?.commit(line.hash);
        this.anchorCheck = this.anchor ? { state: 'ok', detail: '', head: line.hash } : null;
        return this.afterWrite(line, await this.reload());
      }
      throw new Error('git 历史里没有这个项目的合法账本版本');
    });
  }

  // ---- 内部 ----

  private async reload(): Promise<VerifyReport> {
    const bytes = await readIfExists(this.path);
    if (bytes === null) throw new LedgerMissingError(this.path);
    this.current = verifyLedger(bytes);
    await this.checkAnchor();
    return this.current;
  }

  /** 启动规则 3–7（链合法时）。规则 4 的崩溃恢复在这里自动完成。 */
  private async checkAnchor(): Promise<void> {
    if (!this.anchor && anchorEnabled(this.options) && this.current.meta?.projectId) this.anchor = Anchor.forProject(this.current.meta.projectId);
    if (!this.anchor || this.current.status !== 'ok' || !this.current.meta) {
      this.anchorCheck = null;
      return;
    }
    // 尚未截掉的半行不算链尾（规则 2a）。
    const check = await this.anchor.check(this.current.lines, this.current.lastHash);
    this.anchorCheck = check;
    if (check.state === 'recovered') {
      await this.anchor.commit(this.current.lastHash);
      await this.repairTail(this.current);
      const event: Event = { type: 'ledger.head_recovered', previousHead: check.head, recoveredHead: this.current.lastHash, detail: check.detail };
      this.anchorCheck = { state: 'ok', detail: '', head: this.current.lastHash };
      await this.writeEvent(event);
    }
  }

  private assertAnchorWritable(report: VerifyReport): void {
    const a = this.anchorCheck;
    if (a?.state === 'trust_needed') throw new LedgerLockedError(report, `无法核对历史锚点，请先确认当前账本可信（${a.detail}）`);
    if (a?.state === 'conflict') throw new LedgerLockedError(report, `检测到完整性冲突：${a.detail}`);
  }

  /** 规则 2a：截掉崩溃留下的半行；最后一行缺换行则补上。 */
  private async repairTail(report: VerifyReport): Promise<void> {
    if (report.tornTail) {
      await truncate(this.path, report.tornTail.offset);
      this.current = { ...report, tornTail: null, completeBytes: report.tornTail.offset };
    }
    if (report.missingTrailingNewline) {
      await appendBytes(this.path, '\n');
      this.current = { ...this.current, missingTrailingNewline: false, completeBytes: report.completeBytes + 1 };
    }
  }

  private async writeEvent(event: Event): Promise<LedgerLine> {
    if (event.type === 'ledger.meta' || event.type === 'ledger.integrity_override' || event.type === 'ledger.trust_established' || event.type === 'ledger.restored') {
      throw new Error(`${event.type} 只能由账本服务自身写入`);
    }
    const report = this.current;
    const line = buildLine(report.nextSeq, this.now().toISOString(), event, report.lastHash);
    const text = serialize(line);
    // 原子写入协议：head.tmp（意图）→ 追加事件 → rename 为 head。
    await this.anchor?.writeIntent(line.hash);
    await appendBytes(this.path, text);
    await this.anchor?.commit(line.hash);
    if (this.anchorCheck) this.anchorCheck = { state: 'ok', detail: '', head: line.hash };
    return this.afterWrite(line, {
      ...report,
      lines: [...report.lines, line],
      nextSeq: report.nextSeq + 1,
      lastHash: line.hash,
      completeBytes: report.completeBytes + Buffer.byteLength(text),
    });
  }

  private afterWrite(line: LedgerLine, report: VerifyReport): LedgerLine {
    this.current = report;
    return line;
  }
}

export function assertReason(reason: string): void {
  if (typeof reason !== 'string' || [...reason.trim()].length < MIN_REASON_LENGTH) {
    throw new Error(`原因至少 ${MIN_REASON_LENGTH} 个字`);
  }
}

function buildLine(seq: number, at: string, event: Event, prevHash: string): LedgerLine {
  return { seq, at, event, prevHash, hash: lineHash(prevHash, seq, at, event) };
}

function serialize(line: LedgerLine): string {
  return JSON.stringify(line) + '\n';
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeNew(path: string, text: string): Promise<void> {
  const fh = await open(path, 'wx');
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function writeFileAtomic(path: string, bytes: Buffer): Promise<void> {
  const tmp = `${path}.restore-tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(bytes);
    await fh.sync();
  } finally {
    await fh.close();
  }
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

async function appendBytes(path: string, text: string): Promise<void> {
  const fh = await open(path, 'a');
  try {
    await fh.writeFile(text);
    await fh.sync();
  } finally {
    await fh.close();
  }
}
