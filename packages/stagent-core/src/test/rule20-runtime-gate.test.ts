/**
 * Rule20RuntimeGate 纯函数测试
 * ---------------------------
 * 对应 M14.4 / SPEC §9.1 I-23。
 *
 * 测试矩阵：
 *   T1  formatRule20IssueLine: violation 前缀 rule20:
 *   T2  formatRule20IssueLine: warning 前缀 rule20-soft:
 *   T3  formatRule20IssueLine: stageId 缺失回落到 'workflow'
 *   T4  formatRule20IssueLine: type 缺失回落到 'unknown'（防御）
 *   T5  buildGeneratorWarnings: 开关 OFF + verifyResult 提供 → 完全忽略 rule20 行（回滚保障）
 *   T6  buildGeneratorWarnings: 开关 ON + verifyResult undefined → 不崩、不加 rule20 行
 *   T7  buildGeneratorWarnings: 开关 ON + 全 pass → 不加 rule20 行
 *   T8  buildGeneratorWarnings: 开关 ON + violations + warnings 混合 → 按顺序序列化（违反先于提示）
 *   T9  buildGeneratorWarnings: stage_count_near_limit 与 rule20 行并存且顺序固定
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildGeneratorWarnings,
  formatRule20IssueLine,
} from '../Rule20RuntimeGate';
import type { VerifyIssue, VerifyResult } from '../Rule20Verify';

function issue(type: string, stageId: string, message = 'm'): VerifyIssue {
  return { type: type as VerifyIssue['type'], stageId, message };
}

function passResult(): VerifyResult {
  return { passed: true, violations: [], warnings: [] };
}

test('T1 formatRule20IssueLine: violation 使用 rule20: 前缀', () => {
  const line = formatRule20IssueLine(issue('missing-decision-stage', 'stage_impl_x'), 'violation');
  assert.equal(line, 'rule20:missing-decision-stage:stage_impl_x');
});

test('T2 formatRule20IssueLine: warning 使用 rule20-soft: 前缀', () => {
  const line = formatRule20IssueLine(issue('to-issues-missing-chain', 'stage_impl_all'), 'warning');
  assert.equal(line, 'rule20-soft:to-issues-missing-chain:stage_impl_all');
});

test('T3 formatRule20IssueLine: stageId 缺失 → workflow', () => {
  const line = formatRule20IssueLine(issue('software-missing-global-architecture-decision', ''), 'warning');
  assert.equal(line, 'rule20-soft:software-missing-global-architecture-decision:workflow');
});

test('T4 formatRule20IssueLine: type 缺失 → unknown（防御）', () => {
  const line = formatRule20IssueLine({ type: '' as VerifyIssue['type'], stageId: 'stage_a', message: 'x' }, 'violation');
  assert.equal(line, 'rule20:unknown:stage_a');
});

test('T5 buildGeneratorWarnings: 开关 OFF + verifyResult 提供 → 不加 rule20 行（回滚保障）', () => {
  const vr: VerifyResult = {
    passed: false,
    violations: [issue('missing-decision-stage', 'stage_impl_x')],
    warnings: [issue('software-missing-global-architecture-decision', 'workflow')],
  };
  const result = buildGeneratorWarnings({
    stageCount: 10,
    maxStageWarn: 45,
    verifyResult: vr,
    enableRuntimeRule20Verify: false,
  });
  assert.deepEqual(result, [], '开关关闭时即使传入 verifyResult 也不应输出 rule20 行');
});

test('T6 buildGeneratorWarnings: 开关 ON + verifyResult undefined → 不崩，输出空', () => {
  const result = buildGeneratorWarnings({
    stageCount: 10,
    maxStageWarn: 45,
    verifyResult: undefined,
    enableRuntimeRule20Verify: true,
  });
  assert.deepEqual(result, [], '开关开但未传 verifyResult 时容错为空数组');
});

test('T7 buildGeneratorWarnings: 开关 ON + 全 pass → 不加 rule20 行', () => {
  const result = buildGeneratorWarnings({
    stageCount: 10,
    maxStageWarn: 45,
    verifyResult: passResult(),
    enableRuntimeRule20Verify: true,
  });
  assert.deepEqual(result, []);
});

test('T8 buildGeneratorWarnings: 开关 ON + 混合 issues → violations 先于 warnings', () => {
  const vr: VerifyResult = {
    passed: false,
    violations: [
      issue('missing-decision-stage', 'stage_impl_x'),
      issue('broken-naming-pair', 'stage_test_run_y'),
    ],
    warnings: [
      issue('to-issues-missing-chain', 'stage_impl_all'),
      issue('software-missing-global-architecture-decision', 'workflow'),
    ],
  };
  const result = buildGeneratorWarnings({
    stageCount: 10,
    maxStageWarn: 45,
    verifyResult: vr,
    enableRuntimeRule20Verify: true,
  });
  assert.deepEqual(result, [
    'rule20:missing-decision-stage:stage_impl_x',
    'rule20:broken-naming-pair:stage_test_run_y',
    'rule20-soft:to-issues-missing-chain:stage_impl_all',
    'rule20-soft:software-missing-global-architecture-decision:workflow',
  ]);
});

test('T9 buildGeneratorWarnings: stage_count_near_limit 优先且与 rule20 并存', () => {
  const vr: VerifyResult = {
    passed: false,
    violations: [issue('missing-decision-stage', 'stage_impl_x')],
    warnings: [issue('software-missing-global-architecture-decision', 'workflow')],
  };
  const result = buildGeneratorWarnings({
    stageCount: 50,
    maxStageWarn: 45,
    verifyResult: vr,
    enableRuntimeRule20Verify: true,
  });
  assert.deepEqual(result, [
    'stage_count_near_limit',
    'rule20:missing-decision-stage:stage_impl_x',
    'rule20-soft:software-missing-global-architecture-decision:workflow',
  ]);
});

test('T10 buildGeneratorWarnings: stage_count_near_limit 单独存在（开关关，超过阈值）', () => {
  const result = buildGeneratorWarnings({
    stageCount: 50,
    maxStageWarn: 45,
    verifyResult: undefined,
    enableRuntimeRule20Verify: false,
  });
  assert.deepEqual(result, ['stage_count_near_limit']);
});
