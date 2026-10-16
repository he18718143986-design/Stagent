/**
 * M4-1 扫描接入与基线（验收 #1）；M4-2 外观确认与「改了什么」。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor, writeProjectFile } from '../../src/agent/scripted.js';
import type { ChangeView, ChangesProjection } from '../../src/changes/changes.js';
import { Ledger } from '../../src/ledger/index.js';
import type { FeatureView } from '../../src/projection/projection.js';
import type { ChangeDiffView } from '../../src/server/flows/map-flow.js';
import type { OverviewResponse } from '../../src/server/service.js';
import { waitAgent } from '../helpers/agent.js';
import { APP_CHECK, serverProject } from '../helpers/server.js';

const scanner = () =>
  new ScriptedExecutor({
    scanFeatures: async () => [
      { name: '首页', description: '首页', entryFiles: ['app/page.tsx'] },
      { name: '登录', description: '登录页', entryFiles: ['app/login/page.tsx', 'app/api/login/route.ts'] },
      { name: '购物车', description: '购物车', entryFiles: ['app/cart/page.tsx'] },
    ],
    draftExamples: async (input, ctx) => {
      await writeProjectFile(ctx.projectRoot, `${input.draftDir}/a.mjs`, APP_CHECK);
      await writeProjectFile(ctx.projectRoot, `${input.draftDir}/b.mjs`, 'process.exit(1);\n');
      return [
        { given: '已有用户', when: '打开', then: `${input.featureName} 正常`, kind: 'behavior', checkPath: `${input.draftDir}/a.mjs`, summary: '读 x' },
        { given: '已有用户', when: '点按钮', then: `${input.featureName} 有提示`, kind: 'behavior', checkPath: `${input.draftDir}/b.mjs`, summary: '永远失败' },
      ];
    },
  });

describe('M4-1 扫描接入与基线例子', () => {
  it('#1 扫描创建 origin:scan 的功能（带入口文件、全部未验证）；勾选核心功能起草基线，锁定后跑出基线结果', async () => {
    const p = await serverProject(undefined, { agent: scanner() });
    const empty = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(empty.actions.find((a) => a.id === 'scan')).toMatchObject({ enabled: true });
    const started = Date.now();
    expect((await p.call('POST', '/api/scan')).status).toBe(202);
    await waitAgent(p.service);
    expect(Date.now() - started).toBeLessThan(30_000);
    const features = (await p.call<FeatureView[]>('GET', '/api/features')).body;
    expect(features.map((f) => f.name)).toEqual(['首页', '登录', '购物车']);
    expect(features.every((f) => f.origin === 'scan' && f.tag === '接入扫描发现' && f.state === 'unverified')).toBe(true);
    const created = (await Ledger.open(p.root)).events().find((e) => e.type === 'feature.created' && e.name === '登录');
    expect(created).toMatchObject({ entryFiles: ['app/login/page.tsx', 'app/api/login/route.ts'] });
    // 入口文件成为系统地图的初始映射。
    const map = (await p.call<{ features: { name: string; files: { path: string }[] }[] }>('GET', '/api/map')).body;
    expect(map.features.find((f) => f.name === '登录')!.files.map((f) => f.path)).toContain('app/login/page.tsx');

    // 勾选 3 个核心功能补基线例子。
    for (const f of features) {
      expect((await p.call('POST', `/api/features/${f.featureId}/baseline`)).status).toBe(202);
      await waitAgent(p.service);
    }
    const drafts = (await p.call<{ drafts: { exampleId: string; then: string }[] }>('GET', '/api/baseline')).body.drafts;
    expect(drafts).toHaveLength(6);
    // 锁定前的基线草稿可以自由修改，不需要授权。
    expect((await p.call('PUT', `/api/examples/${drafts[0]!.exampleId}/draft`, { then: '首页能打开' })).status).toBe(200);
    // 只锁定每个功能的第一个例子（3 个）。
    const ids = drafts.filter((_, i) => i % 2 === 0).map((d) => d.exampleId);
    expect((await p.call('POST', '/api/baseline/lock', { exampleIds: ids })).status).toBe(202);
    await p.service.waitForRun();
    const after = (await p.call<FeatureView[]>('GET', '/api/features')).body;
    expect(after.flatMap((f) => f.examples).map((x) => x.state)).toEqual(['verified', 'verified', 'verified']);
    expect(after[0]!.examples[0]).toMatchObject({ then: '首页能打开', redCheck: { kind: 'baseline' } });
    const run = (await Ledger.open(p.root)).events().find((e) => e.type === 'run.completed');
    expect(run).toMatchObject({ purpose: 'baseline' });
  });

  it('基线失败不自动改代码：可以「接受现状」——记 pitfall、功能标「已知不一致」、不阻塞账本', async () => {
    const p = await serverProject(undefined, { agent: scanner() });
    await p.call('POST', '/api/scan');
    await waitAgent(p.service);
    const [home] = (await p.call<FeatureView[]>('GET', '/api/features')).body;
    await p.call('POST', `/api/features/${home!.featureId}/baseline`);
    await waitAgent(p.service);
    await p.call('POST', '/api/baseline/lock', {});
    await p.service.waitForRun();
    const failed = (await p.call<FeatureView[]>('GET', '/api/features')).body[0]!.examples.find((x) => x.state === 'failed')!;
    expect((await p.call('POST', `/api/examples/${failed.exampleId}/known-inconsistent`, { reason: '现有按钮确实没有提示，以后再改' })).status).toBe(200);
    const f = (await p.call<FeatureView[]>('GET', '/api/features')).body[0]!;
    expect(f.tags).toContain('已知不一致');
    expect(f.state).toBe('unverified');
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.reasons.some((r) => r.text.includes('被破坏'))).toBe(false);
    const records = (await p.call<{ records: { kind: string; tags: string[] }[] }>('GET', '/api/records')).body.records;
    expect(records[0]).toMatchObject({ kind: 'pitfall', tags: ['已知不一致'] });
  });
});

const VISUAL_CHECK = `import { writeFileSync } from 'node:fs';
// 1x1 PNG
writeFileSync(process.env.STAGENT_SCREENSHOT_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
process.exit(0);
`;

describe('M4-2 外观确认与「改了什么」', () => {
  it('有 visual 例子的改动全部通过后进入「待你确认外观」；不满意回到实现中（事件完整），确认后才可合并', async () => {
    const p = await serverProject();
    await p.writeCheck('.stagent/checks/home/look.mjs', VISUAL_CHECK);
    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '首页改版', track: 'feature' })).body;
    const d = await p.call<{ exampleId: string }>('POST', `/api/changes/${c.changeId}/examples`, {
      featureName: '首页',
      given: '访客',
      when: '打开首页',
      then: '看到新版头图',
      kind: 'visual',
      checkPath: '.stagent/checks/home/look.mjs',
    });
    await p.call('POST', `/api/changes/${c.changeId}/examples/${d.body.exampleId}/red-waive`, { reason: '截图检查只截图' });
    await p.call('POST', `/api/changes/${c.changeId}/examples/lock`, { acknowledgedExampleIds: [d.body.exampleId] });
    await writeProjectFile(p.root, 'src/home.css', 'h1 { color: red; }\n');
    await p.call('POST', `/api/changes/${c.changeId}/check`);
    await p.service.waitForRun();
    let view = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(view.phase).toBe('awaiting_visual');
    expect(view.visualPending[0]!.screenshot).toMatch(/\.stagent\/runs\/.+\/screenshots\/.+\.png$/);
    const shot = await p.app.inject({ method: 'GET', url: `/api/files?path=${encodeURIComponent(view.visualPending[0]!.screenshot!)}` });
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toBe('image/png');
    expect((await p.app.inject({ method: 'GET', url: '/api/files?path=.stagent/ledger/events.jsonl' })).statusCode).toBe(400);
    expect((await p.call<OverviewResponse>('GET', '/api/overview')).body.actions[0]).toMatchObject({ id: 'confirm_visual', enabled: true });

    // 不满意（必须附说明）→ 回到实现中。
    expect((await p.call('POST', `/api/visual/${d.body.exampleId}`, { ok: false })).status).toBe(400);
    expect((await p.call('POST', `/api/visual/${d.body.exampleId}`, { ok: false, note: '头图太暗' })).status).toBe(200);
    view = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(view.phase).toBe('implementing');

    await writeProjectFile(p.root, 'src/home.css', 'h1 { color: orange; }\n');
    await p.call('POST', `/api/changes/${c.changeId}/check`);
    await p.service.waitForRun();
    expect((await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body.phase).toBe('awaiting_visual');
    expect((await p.call('POST', `/api/visual/${d.body.exampleId}`, { ok: true })).status).toBe(200);
    expect((await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body.phase).toBe('mergeable');
    const visual = (await Ledger.open(p.root)).events().filter((e) => e.type === 'visual.confirmed');
    expect(visual.map((e) => (e.type === 'visual.confirmed' ? e.ok : null))).toEqual([false, true]);

    // 「改了什么」：基准 → 工作区、文件数与增删行数、来源、截图、可展开 diff。
    const diff = (await p.call<ChangeDiffView>('GET', `/api/changes/${c.changeId}/diff`)).body;
    expect(diff.totals).toMatchObject({ files: 1, added: 1 });
    expect(diff.files[0]).toMatchObject({ path: 'src/home.css', status: 'added' });
    expect(diff.files[0]!.diff).toContain('+h1 { color: orange; }');
    expect(diff.source).toBe('claude-code');
    expect(diff.screenshots[0]).toMatchObject({ then: '看到新版头图', after: expect.stringContaining('.png') });
  });

  it('开发服务器起不来时可以「修改启动命令」（写回 config.json）', async () => {
    const p = await serverProject();
    expect((await p.call('POST', '/api/config/dev-server', { command: 'npm run dev' })).status).toBe(400);
    expect((await p.call('POST', '/api/config/dev-server', { command: 'npm run dev', url: 'http://localhost:3000' })).status).toBe(200);
    const config = JSON.parse(await readFile(join(p.root, '.stagent/config.json'), 'utf8')) as { devServer: unknown };
    expect(config.devServer).toEqual({ command: 'npm run dev', url: 'http://localhost:3000' });
    void ((await p.call<ChangesProjection>('GET', '/api/changes')).body);
  });
});
