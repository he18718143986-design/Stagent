/**
 * M3-2：起草例子、先失败检查与锁定（验收 #20，Invariant 7）。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor, writeProjectFile } from '../../src/agent/scripted.js';
import type { ChangeView } from '../../src/changes/changes.js';
import { Ledger } from '../../src/ledger/index.js';
import type { FeatureView } from '../../src/projection/projection.js';
import type { OverviewResponse } from '../../src/server/service.js';
import { waitAgent } from '../helpers/agent.js';
import { serverProject } from '../helpers/server.js';

/** 实现前就通过的"空检查"（断言恒为真）。 */
const EMPTY_CHECK = 'process.exit(0);\n';
/** 真正测新行为：src/captcha.js 存在且导出 required === true 才通过。 */
const REAL_CHECK = `import { existsSync } from 'node:fs';
const p = process.env.STAGENT_PROJECT_ROOT + '/src/captcha.js';
if (!existsSync(p)) process.exit(1);
const { required } = await import(p);
process.exit(required === true ? 0 : 1);
`;

function drafter() {
  return new ScriptedExecutor({
    draftExamples: async (input, ctx) => {
      if (input.mode === 'rewrite') {
        await writeProjectFile(ctx.projectRoot, `${input.draftDir}/empty.mjs`, REAL_CHECK);
        return [{ given: '输错 3 次', when: '再登录', then: '要求验证码（重写）', kind: 'behavior', checkPath: `${input.draftDir}/empty.mjs`, summary: '检查 captcha 模块' }];
      }
      await writeProjectFile(ctx.projectRoot, `${input.draftDir}/real.mjs`, REAL_CHECK);
      await writeProjectFile(ctx.projectRoot, `${input.draftDir}/empty.mjs`, EMPTY_CHECK);
      return [
        { given: '用户已注册', when: '输错 3 次密码后登录', then: '要求输入验证码', kind: 'behavior', checkPath: `${input.draftDir}/real.mjs`, summary: '看 captcha.required' },
        { given: '用户已注册', when: '正常登录', then: '不出现验证码', kind: 'behavior', checkPath: `${input.draftDir}/empty.mjs`, summary: '什么都没测' },
      ];
    },
    implement: async (_i, ctx) => {
      await writeProjectFile(ctx.projectRoot, 'src/captcha.js', 'export const required = true;\n');
      return '## 改了什么\n加了验证码\n\n## 取舍\n无\n\n## 例子\n无\n';
    },
  });
}

async function draftedChange(agent = drafter()) {
  const p = await serverProject(undefined, { agent });
  const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '登录加验证码', track: 'feature' })).body;
  await waitAgent(p.service);
  const change = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
  return { p, change, agent };
}

describe('M3-2 起草例子与先失败检查', () => {
  it('新功能档：Claude Code 起草例子（只写草稿目录），每条附大白话摘要；起草会话在守卫里放行草稿目录', async () => {
    const { p, change } = await draftedChange();
    expect(change.phase).toBe('confirm_examples');
    expect(change.pendingDrafts.map((d) => d.summary)).toEqual(['看 captcha.required', '什么都没测']);
    expect(change.pendingDrafts.every((d) => d.checkPath!.startsWith(`.stagent/checks/draft/${change.changeId}/`))).toBe(true);
    // 起草会话结束后，草稿目录对任何会话都关闭。
    const deny = await p.call<{ decision: string }>('POST', '/api/guard/pre-tool-use', {
      hook_event_name: 'PreToolUse',
      session_id: 'scripted-draftExamples-2',
      cwd: p.root,
      tool_name: 'Write',
      tool_input: { file_path: `.stagent/checks/draft/${change.changeId}/x.mjs` },
    });
    expect(deny.body.decision).toBe('deny');
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.actions[0]).toMatchObject({ id: 'run_red_check', enabled: false });
  });

  it('#20 空检查在先失败检查里通过 → 不能锁定，决策卡出现「没测到新行为」；豁免必须填原因，原因进交付报告', async () => {
    const { p, change } = await draftedChange();
    const [real, empty] = change.pendingDrafts;
    // 还没跑先失败检查：不能锁定。
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/lock`, { acknowledgedExampleIds: change.pendingDraftIds })).status).toBe(422);

    const red = await p.call<{ results: { exampleId: string; status: string; qualified: boolean }[] }>('POST', `/api/changes/${change.changeId}/red-check`, { acknowledgedExampleIds: change.pendingDraftIds });
    expect(red.status).toBe(200);
    expect(red.body.results.find((r) => r.exampleId === real!.exampleId)).toMatchObject({ status: 'failed', qualified: true });
    expect(red.body.results.find((r) => r.exampleId === empty!.exampleId)).toMatchObject({ status: 'passed', qualified: false });

    const after = (await p.call<ChangeView>('GET', `/api/changes/${change.changeId}`)).body;
    expect(after.phase).toBe('red_check');
    expect(after.blockers[0]).toMatch(/没测到新行为/);
    const lock = await p.call<{ error: string }>('POST', `/api/changes/${change.changeId}/examples/lock`, { acknowledgedExampleIds: change.pendingDraftIds });
    expect(lock.status).toBe(422);
    expect(lock.body.error).toMatch(/没有失败/);
    // 先失败检查的 run 不让任何功能变成被破坏，也不产生证据。
    const features = (await p.call<FeatureView[]>('GET', '/api/features')).body;
    expect(features.every((f) => f.state !== 'broken' && f.lockedCount === 0)).toBe(true);

    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/${empty!.exampleId}/red-waive`, { reason: '短' })).status).toBe(400);
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/${empty!.exampleId}/red-waive`, { reason: '正常登录本来就没有验证码' })).status).toBe(200);
    const locked = await p.call<ChangeView>('POST', `/api/changes/${change.changeId}/examples/lock`, { acknowledgedExampleIds: change.pendingDraftIds });
    expect(locked.status).toBe(200);
    expect(locked.body.phase).toBe('implementing');

    const events = (await Ledger.open(p.root)).events();
    const locks = events.filter((e) => e.type === 'example.locked');
    expect(locks.map((e) => (e.type === 'example.locked' ? e.redCheck : null))).toEqual([
      { runId: expect.any(String), status: 'failed' },
      { waived: true, reason: '正常登录本来就没有验证码' },
    ]);
    // 锁定后检查移出草稿目录（守卫对任何会话都锁定它）。
    expect(locks.every((e) => e.type === 'example.locked' && !e.checkPath.includes('/draft/'))).toBe(true);
    const report = await p.app.inject({ method: 'GET', url: '/api/report' });
    expect(report.body).toContain('豁免先失败检查：正常登录本来就没有验证码');
  });

  it('先失败检查之后检查内容又被改过：checkHash 不一致，拒绝锁定（422）', async () => {
    const { p, change } = await draftedChange();
    await p.call('POST', `/api/changes/${change.changeId}/red-check`, { acknowledgedExampleIds: change.pendingDraftIds });
    const real = change.pendingDrafts[0]!;
    await writeProjectFile(p.root, real.checkPath!, REAL_CHECK + '// 改了一行\n');
    await p.call('POST', `/api/changes/${change.changeId}/examples/${change.pendingDrafts[1]!.exampleId}/discard`, {});
    const lock = await p.call<{ error: string }>('POST', `/api/changes/${change.changeId}/examples/lock`, { acknowledgedExampleIds: change.pendingDraftIds });
    expect(lock.status).toBe(422);
    expect(lock.body.error).toMatch(/之后被改过/);
  });

  it('不合格 → 让 AI 重写 → 自动对新内容再跑先失败检查 → 合格后锁定 → 实现 → 可合并', async () => {
    const { p, change, agent } = await draftedChange();
    await p.call('POST', `/api/changes/${change.changeId}/red-check`, { acknowledgedExampleIds: change.pendingDraftIds });
    const empty = change.pendingDrafts[1]!;
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/${empty.exampleId}/rewrite`)).status).toBe(202);
    await waitAgent(p.service);
    const rewriteCall = agent.calls.find((c) => c.method === 'draftExamples' && (c.input as { mode: string }).mode === 'rewrite')!;
    expect((rewriteCall.input as { rewrite: { log: string } }).rewrite.log).toContain('$ node');
    const after = (await p.call<ChangeView>('GET', `/api/changes/${change.changeId}`)).body;
    expect(after.pendingDrafts.find((d) => d.exampleId === empty.exampleId)?.redCheck?.status).toBe('failed');
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/lock`, { acknowledgedExampleIds: change.pendingDraftIds })).status).toBe(200);
    expect((await p.call('POST', `/api/changes/${change.changeId}/implement`)).status).toBe(202);
    await waitAgent(p.service);
    const done = (await p.call<ChangeView>('GET', `/api/changes/${change.changeId}`)).body;
    expect(done.phase).toBe('mergeable');
    expect(await readFile(join(p.root, 'src/captcha.js'), 'utf8')).toContain('required = true');
  });

  it('删掉一条草稿；决策卡「我有疑问」由 Claude Code 回答', async () => {
    const { p, change } = await draftedChange();
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/${change.pendingDrafts[1]!.exampleId}/discard`, { reason: '重复' })).status).toBe(200);
    expect((await p.call<ChangeView>('GET', `/api/changes/${change.changeId}`)).body.pendingDrafts).toHaveLength(1);
    const a = await p.call<{ answer: string }>('POST', '/api/decisions/red-check/ask', {
      question: '豁免会有什么风险？',
      card: { question: '这条检查没测到新行为', background: '…', options: [{ label: '重写' }, { label: '豁免' }] },
    });
    expect(a.body.answer).toContain('豁免会有什么风险');
  });


  it('§14：未勾选「读过」时先失败检查与锁定均返回 400；勾选后结论卡动作可启用', async () => {
    const { p, change } = await draftedChange();
    const denied = await p.call<{ error: string }>('POST', `/api/changes/${change.changeId}/red-check`, {});
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/读过/);
    expect((await p.call('POST', `/api/changes/${change.changeId}/examples/lock`, {})).status).toBe(400);
    const o1 = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o1.actions.find((a) => a.id === 'run_red_check')).toMatchObject({ enabled: false, disabledReason: expect.stringMatching(/读过/) });
    await p.call('POST', `/api/changes/${change.changeId}/examples/acknowledge`, { exampleIds: change.pendingDraftIds });
    const o2 = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o2.actions.find((a) => a.id === 'run_red_check')).toMatchObject({ enabled: true });
    expect((await p.call('POST', `/api/changes/${change.changeId}/red-check`, {})).status).toBe(200);
  });

});
