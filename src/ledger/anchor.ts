/**
 * 仓库外链头锚点（规格 §4.1，M6）：~/.stagent/projects/<projectId>/head。
 *
 * 原子写入协议（每次追加）：
 *   1. 计算新事件的 hash；
 *   2. 先把新链头写入 head.tmp 并 fsync——"本次 append 意图"的持久化标记；
 *   3. 追加事件行 + \n 到 events.jsonl 并 fsync；
 *   4. head.tmp rename 为 head，fsync 目录。
 *
 * 启动规则（链本身合法时）：
 *   3. 链头 == head → 正常；残留 head.tmp 删除；
 *   4. head 是链上历史事件（落后）且 head.tmp == 链尾 → 崩溃恢复：完成 rename，写 ledger.head_recovered；
 *   5. head 落后但 head.tmp 不存在或 ≠ 链尾 → 外部追加，完整性冲突（🔒）；
 *   6. head 缺失 → 待你确认信任（TOFU），确认前不建立 head、不允许写入；
 *   7. head 与链上任何事件都对不上 → 完整性冲突（🔒）。
 */
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { projectHomeDir } from '../home/home.js';
import type { LedgerLine, Sha256Hex } from './types.js';

export type AnchorState = 'ok' | 'recovered' | 'trust_needed' | 'conflict';

export interface AnchorCheck {
  state: AnchorState;
  detail: string;
  head: Sha256Hex | null;
}

export class Anchor {
  constructor(readonly dir: string) {}

  static forProject(projectId: string): Anchor {
    return new Anchor(projectHomeDir(projectId));
  }

  get headPath(): string {
    return join(this.dir, 'head');
  }

  get tmpPath(): string {
    return join(this.dir, 'head.tmp');
  }

  async readHead(): Promise<Sha256Hex | null> {
    return readTrimmed(this.headPath);
  }

  async readTmp(): Promise<Sha256Hex | null> {
    return readTrimmed(this.tmpPath);
  }

  /** 协议第 2 步：先写 head.tmp 并 fsync。 */
  async writeIntent(hash: Sha256Hex): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const fh = await open(this.tmpPath, 'w');
    try {
      await fh.writeFile(hash + '\n');
      await fh.sync();
    } finally {
      await fh.close();
    }
  }

  /**
   * 协议第 4 步：head.tmp → head（原子替换），fsync 目录。
   * 另一个只读进程按规则 3 删掉了"尚未落账"的 head.tmp 时（极小的竞态窗口），用 expected 重新写一次再替换。
   */
  async commit(expected?: Sha256Hex): Promise<void> {
    try {
      await rename(this.tmpPath, this.headPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || !expected) throw err;
      await this.writeIntent(expected);
      await rename(this.tmpPath, this.headPath);
    }
    await syncDir(this.dir);
  }

  /** 直接写 head（TOFU 确认、恢复后），同样走 tmp + rename。 */
  async set(hash: Sha256Hex): Promise<void> {
    await this.writeIntent(hash);
    await this.commit(hash);
  }

  async clearTmp(): Promise<void> {
    await rm(this.tmpPath, { force: true });
  }

  /** 按启动规则 3–7 核对链与锚点（链本身合法时调用）。 */
  async check(lines: readonly LedgerLine[], tail: Sha256Hex): Promise<AnchorCheck> {
    const head = await this.readHead();
    const tmp = await this.readTmp();
    if (head === null) {
      return { state: 'trust_needed', detail: `本机没有 ${this.headPath}`, head };
    }
    if (head === tail) {
      if (tmp !== null) await this.clearTmp(); // 规则 3：上次 append 没有发生
      return { state: 'ok', detail: '', head };
    }
    const index = lines.findIndex((l) => l.hash === head);
    if (index !== -1) {
      if (tmp === tail) return { state: 'recovered', detail: `head 落后 ${lines.length - 1 - index} 个事件，head.tmp 与链尾一致`, head };
      return {
        state: 'conflict',
        detail: `账本在锚点之后多了 ${lines.length - 1 - index} 个事件，且没有 head.tmp 佐证（可能是在 Stagent 之外追加的）`,
        head,
      };
    }
    return { state: 'conflict', detail: '本机记录的链头不在 events.jsonl 的任何事件上（账本可能被整体重写）', head };
  }
}

async function readTrimmed(path: string): Promise<string | null> {
  try {
    const s = (await readFile(path, 'utf8')).trim();
    return s || null;
  } catch {
    return null;
  }
}

async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // 部分平台不支持对目录 fsync
  }
}

