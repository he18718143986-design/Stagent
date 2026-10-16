/**
 * M6：仓库外链头锚点（验收 #7、#8、#18，规格 §4.1 启动规则 3–7）。
 * 每个测试有独立的 STAGENT_HOME（test/setup.ts），锚点在 $STAGENT_HOME/projects/<projectId>/head。
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Anchor } from '../../src/ledger/anchor.js';
import { Ledger, lineHash, type Event, type LedgerLine } from '../../src/ledger/index.js';
import { buildServer } from '../../src/server/http.js';
import { StagentService, type OverviewResponse } from '../../src/server/service.js';
import { gitIn, gitProject, nodeConfig } from '../helpers/project.js';
import { tmpProject } from '../helpers/tmp.js';

const feature = (n: number): Event => ({ type: 'feature.created', featureId: `f${n}`, name: `功能 ${n}`, origin: 'new' });

async function seeded(count = 2) {
  const root = await tmpProject();
  const ledger = await Ledger.init(root, { projectId: 'p-anchor' });
  for (let i = 1; i <= count; i++) await ledger.append(feature(i));
  return { root, ledger, anchor: Anchor.forProject('p-anchor') };
}

/** 在 Stagent 之外向 events.jsonl 追加一条格式合法、链条自洽的事件（不动 ~/.stagent）。 */
async function forgeAppend(root: string, event: Event): Promise<string> {
  const path = Ledger.pathFor(root);
  const text = await readFile(path, 'utf8');
  const last = JSON.parse(text.trimEnd().split('\n').at(-1)!) as LedgerLine;
  const seq = last.seq + 1;
  const at = new Date().toISOString();
  const hash = lineHash(last.hash, seq, at, event);
  await writeFile(path, text + JSON.stringify({ seq, at, event, prevHash: last.hash, hash }) + '\n');
  return hash;
}

describe('M6 链头锚点', () => {
  it('每次追加后 head == 链尾，且不留 head.tmp（原子写入协议）', async () => {
    const { ledger, anchor } = await seeded(2);
    expect(await anchor.readHead()).toBe(ledger.report.lastHash);
    expect(await anchor.readTmp()).toBeNull();
    expect(ledger.anchorStatus).toMatchObject({ enabled: true, state: 'ok' });
  });

  it('#7 删除 head 后启动：要求确认信任（TOFU）；确认前不建立 head、不允许写入', async () => {
    const { root, anchor } = await seeded(2);
    await rm(anchor.headPath);
    const ledger = await Ledger.open(root);
    expect(ledger.anchorStatus.state).toBe('trust_needed');
    expect(ledger.state).toBe('locked');
    await expect(ledger.append(feature(9))).rejects.toThrow(/确认当前账本可信/);
    expect(await anchor.readHead()).toBeNull();

    const line = await ledger.establishTrust('换了新电脑，我确认账本可信');
    expect(line.event).toMatchObject({ type: 'ledger.trust_established', by: 'user' });
    expect(await anchor.readHead()).toBe(line.hash);
    expect((await Ledger.open(root)).state).toBe('ok');
  });

  it('#8 append 之后、rename 之前崩溃（head.tmp == 链尾，head 落后）：自动前移 head 并写 ledger.head_recovered，不锁定', async () => {
    const { root, ledger, anchor } = await seeded(2);
    const previous = ledger.report.lastHash;
    // 模拟协议第 2、3 步完成、第 4 步之前崩溃。
    const hash = await forgeAppend(root, feature(3));
    await anchor.writeIntent(hash);
    const reopened = await Ledger.open(root);
    expect(reopened.state).toBe('ok');
    const last = reopened.lines().at(-1)!;
    expect(last.event).toMatchObject({ type: 'ledger.head_recovered', previousHead: previous, recoveredHead: hash });
    expect(await anchor.readHead()).toBe(last.hash);
    expect(await anchor.readTmp()).toBeNull();
  });

  it('#18 外部追加攻击：重算链条使之自洽、不动 ~/.stagent → 没有 head.tmp 佐证，进入 🔒，不自动前移 head', async () => {
    const { root, ledger, anchor } = await seeded(2);
    const head = ledger.report.lastHash;
    await forgeAppend(root, feature(66));
    await forgeAppend(root, { type: 'claim.reported', changeId: 'c', text: '伪造' });
    const reopened = await Ledger.open(root);
    expect(reopened.report.status).toBe('ok'); // 链本身合法
    expect(reopened.state).toBe('locked');
    expect(reopened.anchorStatus).toMatchObject({ state: 'conflict' });
    expect(reopened.anchorStatus.detail).toMatch(/多了 2 个事件/);
    expect(await anchor.readHead()).toBe(head);
    // head.tmp 存在但不等于链尾（例如上一次 append 的残留）也不算崩溃恢复。
    await anchor.writeIntent('0'.repeat(64));
    expect((await Ledger.open(root)).anchorStatus.state).toBe('conflict');
  });

  it('head 与链上任何事件都对不上（整本重写）→ 🔒；「接受当前状态」写 integrity_override 并前移 head', async () => {
    const { root, anchor } = await seeded(2);
    await writeFile(anchor.headPath, 'f'.repeat(64) + '\n');
    const ledger = await Ledger.open(root);
    expect(ledger.anchorStatus.state).toBe('conflict');
    const line = await ledger.acceptCurrentState('我确认这个账本是我自己整理过的');
    expect(line.event).toMatchObject({ type: 'ledger.integrity_override', brokenLinks: [] });
    expect((line.event as { reason: string }).reason).toMatch(/外部锚点冲突/);
    expect(await anchor.readHead()).toBe(line.hash);
    expect((await Ledger.open(root)).state).toBe('ok');
  });

  it('从 git 历史恢复：恢复出包含锚点的更短合法链，写 ledger.restored，head 一并前移', async () => {
    const { root } = await gitProject();
    const ledger = await Ledger.open(root);
    await ledger.append(feature(1));
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', 'ledger');
    const committedSeq = ledger.report.nextSeq;
    await ledger.append(feature(2));
    // 外部追加 → 冲突
    await forgeAppend(root, feature(99));
    const locked = await Ledger.open(root);
    expect(locked.anchorStatus.state).toBe('conflict');
    const line = await locked.restoreFromGit(root, '从最近一次提交恢复');
    expect(line.event).toMatchObject({ type: 'ledger.restored', discardedLines: 2, by: 'user' });
    expect(line.seq).toBe(committedSeq);
    const reopened = await Ledger.open(root);
    expect(reopened.state).toBe('ok');
    expect(reopened.events().filter((e) => e.type === 'feature.created').map((e) => (e as { featureId: string }).featureId)).toEqual(['f1']);
  });

  it('服务：TOFU 卡片 → POST /api/ledger/recover establish_trust', async () => {
    const { root } = await gitProject();
    await rm(Anchor.forProject('p-test').headPath);
    const svc = await StagentService.open(root, { config: nodeConfig(), agent: null, docsDebounceMs: 0 });
    const app = await buildServer(svc, { serveWeb: false });
    const o = (await app.inject({ method: 'GET', url: '/api/overview' })).json() as OverviewResponse;
    expect(o).toMatchObject({ status: 'ledger_modified', title: '无法核对历史锚点' });
    expect(o.actions[0]).toMatchObject({ id: 'establish_trust' });
    expect((await app.inject({ method: 'POST', url: '/api/changes', payload: { description: 'x' } })).statusCode).toBe(423);
    expect((await app.inject({ method: 'POST', url: '/api/ledger/recover', payload: { mode: 'establish_trust' } })).statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/overview' })).json() as OverviewResponse;
    expect(after.status).not.toBe('ledger_modified');
    await app.close();
    await svc.dispose();
  });

  it('STAGENT_ANCHOR=off 时不启用锚点（只校验链内一致性）', async () => {
    process.env.STAGENT_ANCHOR = 'off';
    try {
      const { ledger, anchor } = await seeded(1);
      expect(ledger.anchorStatus).toEqual({ enabled: false, state: 'disabled' });
      expect(await anchor.readHead()).toBeNull();
    } finally {
      delete process.env.STAGENT_ANCHOR;
    }
  });
});
