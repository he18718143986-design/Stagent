/**
 * M3-1：Claude Code 驱动的实现与自动修复循环（验收 #4 修复部分、#5、#10，Invariant 1）、费用上限、实现中断。
 * 用 ScriptedExecutor 代替真实调用：它按脚本改文件、按固定格式回报。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor, writeProjectFile } from '../../src/agent/scripted.js';
import type { ChangeView, ChangesProjection } from '../../src/changes/changes.js';
import { Ledger } from '../../src/ledger/index.js';
import type { FeatureView } from '../../src/projection/projection.js';
import type { OverviewResponse } from '../../src/server/service.js';
import { StagentService } from '../../src/server/service.js';
import { nodeConfig } from '../helpers/project.js';
import { REPORT, waitAgent } from '../helpers/agent.js';
import { APP_CHECK, PASS, serverProject } from '../helpers/server.js';

const BROKEN = 'export const x = 2;\n';
const FIXED = 'export const x = 1;\n';

describe('M3-1 实现与自动修复', () => {
  it('#10 小改动：从描述到可合并不需要任何人工确认；最终合并只需一次 merge 授权', async () => {
    const agent = new ScriptedExecutor({
      implement: async (_i, ctx) => {
        await writeProjectFile(ctx.projectRoot, 'src/style.css', 'button { color: blue; }\n');
        return REPORT();
      },
    });
    const p = await serverProject(undefined, { agent });
    await p.lock('登录', '.stagent/checks/login.mjs', APP_CHECK);
    const first = (await p.call<ChangesProjection>('GET', '/api/changes')).body.active!;
    await p.runAll();
    expect((await p.call('POST', `/api/changes/${first.changeId}/merge`)).status).toBe(200);
    await waitAgent(p.service);

    // 用户只做一件事：描述改动。
    const before = agent.calls.length;
    const created = await p.call<ChangeView>('POST', '/api/changes', { description: '把按钮改成蓝色' });
    expect(created.status).toBe(201);
    await waitAgent(p.service);
    const change = (await p.call<ChangeView>('GET', `/api/changes/${created.body.changeId}`)).body;
    expect(change).toMatchObject({ track: 'small', phase: 'mergeable', fixRounds: 0 });
    expect(change.claims).toHaveLength(1);
    expect(agent.calls.slice(before).map((c) => c.method)).toEqual(['classifyChange', 'implement', 'attributeFiles']);
    // 一次授权点击即合并。
    expect((await p.call('POST', `/api/changes/${change.changeId}/merge`)).status).toBe(200);
  });

  it('#4 改坏已验收例子 → 被阻止 → 自动交给 Claude Code 修复 → 可合并；修复提示附失败日志与例子', async () => {
    const agent = new ScriptedExecutor({
      implement: async (_i, ctx) => {
        await writeProjectFile(ctx.projectRoot, 'src/app.js', BROKEN);
        return REPORT();
      },
      fix: async (_i, ctx) => {
        await writeProjectFile(ctx.projectRoot, 'src/app.js', FIXED);
        return REPORT();
      },
    });
    const p = await serverProject(undefined, { agent });
    const a = await p.lock('登录', '.stagent/checks/login.mjs', APP_CHECK);
    await p.runAll();
    await p.call('POST', `/api/changes/${a.changeId}/merge`);

    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '重构 app' })).body;
    await waitAgent(p.service);
    const after = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(after.phase).toBe('mergeable');
    expect(after.fixRounds).toBe(1);
    const fixCall = agent.calls.find((x) => x.method === 'fix')!.input as { failures: { exampleId: string; status: string }[]; examples: unknown[] };
    expect(fixCall.failures.map((f) => f.exampleId)).toEqual([a.exampleId]);
    expect(fixCall.failures[0]!.status).toBe('failed');
  });

  it('自动修复最多 3 轮，之后停下等你（继续修复 / 放弃 / 授权强行合并）', async () => {
    const agent = new ScriptedExecutor({
      implement: async (_i, ctx) => {
        await writeProjectFile(ctx.projectRoot, 'src/app.js', BROKEN);
        return REPORT();
      },
      fix: async (i, ctx) => {
        await writeProjectFile(ctx.projectRoot, 'src/app.js', `export const x = ${10 + i.round};\n`);
        return REPORT();
      },
    });
    const p = await serverProject(undefined, { agent });
    const a = await p.lock('登录', '.stagent/checks/login.mjs', APP_CHECK);
    await p.runAll();
    await p.call('POST', `/api/changes/${a.changeId}/merge`);
    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '重构 app' })).body;
    await waitAgent(p.service);
    const after = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(after.phase).toBe('blocked');
    expect(agent.calls.filter((x) => x.method === 'fix')).toHaveLength(3);
    expect(after.fixRounds).toBe(3);
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.actions.map((x) => x.label)).toContain('继续修复（Claude Code）');
    expect(o.actions.find((x) => x.id === 'merge_override')?.enabled).toBe(true);
    expect(o.actions.find((x) => x.id === 'abandon')?.enabled).toBe(true);
  });

  it('#5 / Invariant 1：AI 回报"已实现"但检查 errored → 仅 AI 声称；claim + failed → 显示失败，claim 保留', async () => {
    let exampleIds: string[] = [];
    const agent = new ScriptedExecutor({ implement: async () => REPORT(exampleIds) });
    const p = await serverProject(nodeConfig({ flakyRetries: 0, checkTimeoutMs: 10_000 }), { agent, autoAgent: false });
    const errored = await p.lock('导出', '.stagent/checks/export.mjs', 'process.exit(127);\n');
    const failing = await p.lock('支付', '.stagent/checks/pay.mjs', 'process.exit(1);\n');
    exampleIds = [errored.exampleId, failing.exampleId];
    await p.call('POST', `/api/changes/${errored.changeId}/implement`);
    await waitAgent(p.service);
    const features = (await p.call<FeatureView[]>('GET', '/api/features')).body;
    const ex = features.flatMap((f) => f.examples);
    const e1 = ex.find((x) => x.exampleId === errored.exampleId)!;
    const e2 = ex.find((x) => x.exampleId === failing.exampleId)!;
    expect(e1).toMatchObject({ state: 'unverified', reason: 'ai_claim_only' });
    expect(e2.state).toBe('failed');
    expect(e2.claims.length).toBeGreaterThan(0);
    expect(features.some((f) => f.state === 'verified')).toBe(false);
  });

  it('费用上限：达到 perChange 时暂停，结论卡给出「提高上限」；budget_raise 授权后可以继续', async () => {
    const agent = new ScriptedExecutor({ implement: async () => REPORT() }, { costPerCall: 1 });
    const p = await serverProject(nodeConfig({ budget: { perChange: 1.5 } }), { agent, autoAgent: false });
    await p.lock('登录', '.stagent/checks/login.mjs', PASS);
    const c = (await p.call<ChangesProjection>('GET', '/api/changes')).body.active!;
    await p.call('POST', `/api/changes/${c.changeId}/implement`);
    await waitAgent(p.service);
    expect((await p.call('POST', `/api/changes/${c.changeId}/implement`)).status).toBe(202);
    await waitAgent(p.service);
    const blocked = await p.call<{ error: string }>('POST', `/api/changes/${c.changeId}/implement`);
    expect(blocked.status).toBe(402);
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.budget.exceeded).toMatchObject({ scope: 'perChange', limit: 1.5 });
    expect(o.actions[0]).toMatchObject({ id: 'budget_raise', enabled: true });
    expect((await p.call('POST', '/api/auth', { action: 'budget_raise', reason: '这个改动比较大', amount: 5 })).status).toBe(200);
    expect((await p.call<OverviewResponse>('GET', '/api/overview')).body.budget.exceeded).toBeNull();
    expect((await p.call('POST', `/api/changes/${c.changeId}/implement`)).status).toBe(202);
    await waitAgent(p.service);
  });

  it('Claude Code 不可用时：实现、修复等入口返回 503 并写明原因，外部改动流程仍可用', async () => {
    const p = await serverProject(undefined, { agent: new ScriptedExecutor({}, { available: false }) });
    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '改文案' })).body;
    expect(c.phase).toBe('implementing');
    const r = await p.call<{ error: string }>('POST', `/api/changes/${c.changeId}/implement`);
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/未登录/);
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.agent.availability.available).toBe(false);
  });

  it('服务重启时有进行中的 AI 任务：标「实现中断」，可续接会话（resume）', async () => {
    const agent = new ScriptedExecutor({ implement: async () => REPORT() });
    const p = await serverProject(undefined, { agent, autoAgent: false });
    await p.lock('登录', '.stagent/checks/login.mjs', PASS);
    const c = (await p.call<ChangesProjection>('GET', '/api/changes')).body.active!;
    // 模拟上次进程在实现中途退出：留下 agent-task 标记。
    await mkdir(join(p.root, '.stagent/runs'), { recursive: true });
    await writeFile(join(p.root, '.stagent/runs/agent-task.json'), JSON.stringify({ changeId: c.changeId, kind: 'implement', sessionId: 'sess-42' }));
    const svc = await StagentService.open(p.root, { config: nodeConfig(), agent, autoAgent: false, docsDebounceMs: 0 });
    const view = (await svc.changes()).active!;
    expect(view.interrupted?.reason).toMatch(/正在实现/);
    expect((await svc.overview()).actions[0]).toMatchObject({ id: 'resume_agent' });
    const { resumeAgent } = await import('../../src/server/flows/agent-flow.js');
    await resumeAgent(svc, c.changeId);
    await waitAgent(svc);
    expect((agent.calls.at(-2)?.method ?? agent.calls.at(-1)?.method)).toBeDefined();
    expect((await svc.changes()).active?.interrupted).toBeNull();
    await svc.dispose();
    const events = (await Ledger.open(p.root)).events();
    expect(events.some((e) => e.type === 'change.interrupted')).toBe(true);
    expect(await readFile(join(p.root, '.stagent/runs/agent-task.json')).catch(() => null)).toBeNull();
  });
});
