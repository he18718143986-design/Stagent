/**
 * 验收 #23：需求计划。
 */
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor } from '../../src/agent/scripted.js';
import type { ChangeView } from '../../src/changes/changes.js';
import { validateSteps, type PlanView } from '../../src/plans/plans.js';
import type { OverviewResponse } from '../../src/server/service.js';
import { waitAgent } from '../helpers/agent.js';
import { PASS, serverProject } from '../helpers/server.js';

function planner(featureIds: () => string[]) {
  return new ScriptedExecutor({
    classifyChange: () => ({ track: 'feature', targetFeatureIds: featureIds(), suggestPlan: true, rationale: '会改登录和购物车' }),
    draftPlan: () => ({
      rationale: '先打基础再接入',
      steps: [
        { stepId: 's1', title: '会员数据', intent: '加会员等级字段', track: 'feature', featureIds: featureIds().slice(0, 1) },
        { stepId: 's2', title: '会员价', intent: '购物车按会员等级打折', track: 'feature', featureIds: featureIds().slice(1), dependsOn: ['s1'] },
      ],
    }),
  });
}

describe('#23 需求计划', () => {
  it('触及 ≥ 2 个功能的需求 → 建议拆成计划；确认后逐步开始；依赖未完成时等待前置；互斥规则不变', async () => {
    let ids: string[] = [];
    const p = await serverProject(undefined, { agent: planner(() => ids), autoAgent: false });
    const login = await p.lock('登录', '.stagent/checks/login.mjs', PASS);
    const cart = await p.lock('购物车', '.stagent/checks/cart.mjs', PASS, undefined);
    ids = [login.featureId, cart.featureId];
    await p.runAll();
    await p.call('POST', `/api/changes/${login.changeId}/merge`);
    await waitAgent(p.service);

    const suggest = await p.call<{ suggestPlan: boolean; rationale: string }>('POST', '/api/changes', { description: '加会员体系' });
    expect(suggest.status).toBe(200);
    expect(suggest.body).toMatchObject({ suggestPlan: true, rationale: '会改登录和购物车' });

    const drafted = await p.call<PlanView>('POST', '/api/plans', { requirement: '加会员体系' });
    expect(drafted.status).toBe(201);
    expect(drafted.body).toMatchObject({ status: 'draft', rationale: '先打基础再接入' });
    // 确认前可以改标题。
    const steps = drafted.body.steps.map(({ stepId, title, intent, track, featureIds, dependsOn }) => ({ stepId, title: stepId === 's1' ? '会员等级数据' : title, intent, track, featureIds, dependsOn }));
    const plan = (await p.call<PlanView>('POST', `/api/plans/${drafted.body.planId}/confirm`, { steps })).body;
    expect(plan.status).toBe('active');
    expect(plan.steps.map((s) => [s.title, s.statusLabel])).toEqual([
      ['会员等级数据', '可开始'],
      ['会员价', '等待前置'],
    ]);
    expect((await p.call('POST', '/api/plans', { requirement: '另一个计划' })).status).toBe(409);
    expect((await p.call('POST', `/api/plans/${plan.planId}/steps/s2/start`)).status).toBe(409);

    const step1 = await p.call<ChangeView>('POST', `/api/plans/${plan.planId}/steps/s1/start`);
    expect(step1.status).toBe(201);
    expect(step1.body).toMatchObject({ planId: plan.planId, stepId: 's1', track: 'feature', targetFeatureIds: [login.featureId] });
    // 计划进行中，改动互斥规则不变。
    expect((await p.call('POST', '/api/changes', { description: '顺手改个文案', force: true })).status).toBe(409);
    const o = (await p.call<OverviewResponse>('GET', '/api/overview')).body;
    expect(o.planLine).toMatchObject({ current: 1, total: 2, statusLabel: '进行中' });

    // 修订：已开始的步骤不能删。
    expect((await p.call('POST', `/api/plans/${plan.planId}/revise`, { steps: [steps[1]], reason: '不做第一步了' })).status).toBe(409);
    expect((await p.call('POST', `/api/plans/${plan.planId}/revise`, { steps, reason: '短' })).status).toBe(400);

    // 放弃第 1 步 → 待重做；取消计划不影响已合并的改动。
    await p.call('POST', '/api/auth', { action: 'abandon', changeId: step1.body.changeId, reason: '换个做法' });
    const redo = (await p.call<PlanView>('GET', `/api/plans/${plan.planId}`)).body;
    expect(redo.steps[0]!.statusLabel).toBe('待重做');
    expect((await p.call('POST', `/api/plans/${plan.planId}/close`, { outcome: 'completed' })).status).toBe(409);
    expect((await p.call<PlanView>('POST', `/api/plans/${plan.planId}/close`, { outcome: 'cancelled', reason: '先不做' })).body.status).toBe('cancelled');
  });

  it('force:true 坚持作为单个改动', async () => {
    const p = await serverProject(undefined, { agent: planner(() => []), autoAgent: false });
    const r = await p.call<ChangeView>('POST', '/api/changes', { description: '加会员体系', force: true });
    expect(r.status).toBe(201);
    expect(r.body.track).toBe('feature');
  });

  it('步骤校验：id 唯一、依赖存在、无环', () => {
    expect(validateSteps([{ stepId: 'a', title: 'A', intent: '', track: 'small', dependsOn: ['b'] }, { stepId: 'b', title: 'B', intent: '', track: 'small', dependsOn: ['a'] }])).toContain('步骤依赖有环');
    expect(validateSteps([{ stepId: 'a', title: 'A', intent: '', track: 'small', dependsOn: ['x'] }])[0]).toMatch(/不存在/);
  });
});
