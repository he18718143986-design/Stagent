import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { WorkspaceConfiguration } from '../platform/HostTypes';
import {
  bestOfNCountForStage,
  bestOfNRoleForStage,
  readBestOfNConfig,
  runBestOfNCandidates,
  type BestOfNCandidate,
} from '../best-of-n/bestOfNStage';
import type { CandidateOutcome } from '../best-of-n/BestOfNTypes';

function cfg(values: Record<string, unknown>): WorkspaceConfiguration {
  return {
    get<T>(key: string, def?: T): T | undefined {
      return (key in values ? (values[key] as T) : def);
    },
    has: (key: string) => key in values,
  };
}

test('readBestOfNConfig 默认关、N=3、roles=impl/test_write', () => {
  const c = readBestOfNConfig(cfg({}));
  assert.equal(c.enabled, false);
  assert.equal(c.n, 3);
  assert.deepEqual([...c.roles].sort(), ['impl', 'test_write']);
});

test('readBestOfNConfig 读取 enabled / count / roles 覆盖（含非法值回退）', () => {
  const c = readBestOfNConfig(
    cfg({
      'execution.bestOfN.enabled': true,
      'execution.bestOfN.count': 5,
      'execution.bestOfN.roles': ['impl', 'decide', 'bogus'],
    }),
  );
  assert.equal(c.enabled, true);
  assert.equal(c.n, 5);
  assert.deepEqual([...c.roles].sort(), ['decide', 'impl']);
  // 非法 count 回退默认
  assert.equal(readBestOfNConfig(cfg({ 'execution.bestOfN.count': 99 })).n, 3);
  assert.equal(readBestOfNConfig(cfg({ 'execution.bestOfN.count': 0 })).n, 3);
});

test('bestOfNRoleForStage：impl/test_write/decide 命中；bundle/fix/stub 排除', () => {
  assert.equal(bestOfNRoleForStage('stage_impl_pipeline'), 'impl');
  assert.equal(bestOfNRoleForStage('stage_test_write_store'), 'test_write');
  assert.equal(bestOfNRoleForStage('stage_decide_main'), 'decide');
  assert.equal(bestOfNRoleForStage('stage_impl_pipeline_stagent_bundle_write'), null);
  assert.equal(bestOfNRoleForStage('stage_fix_if_failed_store'), null);
  assert.equal(bestOfNRoleForStage('stage_materialize_stub_main'), null);
  assert.equal(bestOfNRoleForStage('stage_test_run_pipeline'), null);
});

test('bestOfNCountForStage：关→1；启用且角色命中→N；启用但角色未启用→1', () => {
  const off = readBestOfNConfig(cfg({}));
  assert.equal(bestOfNCountForStage('stage_impl_pipeline', off), 1);
  const on = readBestOfNConfig(cfg({ 'execution.bestOfN.enabled': true, 'execution.bestOfN.count': 3 }));
  assert.equal(bestOfNCountForStage('stage_impl_pipeline', on), 3);
  assert.equal(bestOfNCountForStage('stage_test_write_store', on), 3);
  // decide 默认 roles 不含 → 1（避免全量成本）
  assert.equal(bestOfNCountForStage('stage_decide_main', on), 1);
  assert.equal(bestOfNCountForStage('stage_fix_if_failed_store', on), 1);
});

function cand(o: CandidateOutcome): BestOfNCandidate<string> {
  return { outcome: o, payload: o.id };
}

test('runBestOfNCandidates：选通过 Strict-QA 的最优候选（质量分破平）', async () => {
  const outcomes: CandidateOutcome[] = [
    { id: 'a', passed: false, gateViolations: 2, qualityScore: 0.9 },
    { id: 'b', passed: true, gateViolations: 0, qualityScore: 0.6 },
    { id: 'c', passed: true, gateViolations: 0, qualityScore: 0.8 },
  ];
  let calls = 0;
  const r = await runBestOfNCandidates(3, async (i) => {
    calls += 1;
    return cand(outcomes[i]!);
  });
  assert.equal(calls, 3);
  assert.equal(r.anyPassed, true);
  assert.equal(r.selection.selectedId, 'c'); // 通过中质量更高
  assert.equal(r.chosen.payload, 'c');
  assert.deepEqual(r.summary, { total: 3, passed: 2, failed: 1 });
});

test('runBestOfNCandidates：全失败 → anyPassed=false，回退 ranked[0]（最优劣者，不伪绿）', async () => {
  const outcomes: CandidateOutcome[] = [
    { id: 'a', passed: false, gateViolations: 3 },
    { id: 'b', passed: false, gateViolations: 1 },
    { id: 'c', passed: false, gateViolations: 5 },
  ];
  const r = await runBestOfNCandidates(3, async (i) => cand(outcomes[i]!));
  assert.equal(r.anyPassed, false);
  assert.equal(r.selection.selectedId, null);
  assert.equal(r.chosen.outcome.id, 'b'); // 违规最少者排首
  assert.deepEqual(r.summary, { total: 3, passed: 0, failed: 3 });
});

test('runBestOfNCandidates：N=1 等价单次', async () => {
  const r = await runBestOfNCandidates(1, async () => cand({ id: 'solo', passed: true, gateViolations: 0 }));
  assert.equal(r.anyPassed, true);
  assert.equal(r.chosen.payload, 'solo');
  assert.deepEqual(r.summary, { total: 1, passed: 1, failed: 0 });
});
