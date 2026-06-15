import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_RED_GREEN_MODE,
  evaluateRedGreen,
  findPairedTestStage,
  interpretRedFromExitCode,
  isHorizontalTddPlan,
  resolveRedGreenMode,
  semanticOfStage,
} from '../RedGreenGate';
import { verifyRule20 } from '../Rule20Verify';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function s(partial: Partial<Stage> & Pick<Stage, 'id'>): Stage {
  return {
    title: partial.id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...partial,
  };
}

function testRun(id: string): Stage {
  return {
    id,
    title: id,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'python -c "import x"', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function wf(stages: Stage[], taskType: WorkflowDefinition['meta']['taskType'] = 'prototype'): WorkflowDefinition {
  return {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType, userInput: 'u', createdAt: '' },
    stages,
  };
}

test('resolveRedGreenMode 仅接受 off/warn/hard，其余回落默认 warn', () => {
  assert.equal(resolveRedGreenMode('off'), 'off');
  assert.equal(resolveRedGreenMode('hard'), 'hard');
  assert.equal(resolveRedGreenMode('warn'), 'warn');
  assert.equal(resolveRedGreenMode(undefined), DEFAULT_RED_GREEN_MODE);
  assert.equal(resolveRedGreenMode('weird'), 'warn');
});

test('semanticOfStage 提取切片名', () => {
  assert.equal(semanticOfStage('stage_impl_reader'), 'reader');
  assert.equal(semanticOfStage('stage_test_run_reader'), 'reader');
  assert.equal(semanticOfStage('stage_test_write_reader'), 'reader');
  assert.equal(semanticOfStage('stage_decide_reader'), undefined);
});

test('findPairedTestStage 优先 test_run，其次 test_write', () => {
  const w = wf([
    s({ id: 'stage_impl_reader' }),
    s({ id: 'stage_test_write_reader' }),
    testRun('stage_test_run_reader'),
  ]);
  assert.equal(findPairedTestStage(w, 'stage_impl_reader')?.id, 'stage_test_run_reader');

  const w2 = wf([s({ id: 'stage_impl_reader' }), s({ id: 'stage_test_write_reader' })]);
  assert.equal(findPairedTestStage(w2, 'stage_impl_reader')?.id, 'stage_test_write_reader');

  const w3 = wf([s({ id: 'stage_impl_reader' })]);
  assert.equal(findPairedTestStage(w3, 'stage_impl_reader'), undefined);
});

test('interpretRedFromExitCode：非零=RED', () => {
  assert.equal(interpretRedFromExitCode(1), true);
  assert.equal(interpretRedFromExitCode(2), true);
  assert.equal(interpretRedFromExitCode(0), false);
});

test('evaluateRedGreen：门未激活 / RED 前置 → pass', () => {
  assert.equal(evaluateRedGreen({ mode: 'off', pairedTestExists: true, ranTest: true, red: false }).outcome, 'pass');
  assert.equal(evaluateRedGreen({ mode: 'hard', pairedTestExists: false, ranTest: true, red: false }).outcome, 'pass');
  assert.equal(evaluateRedGreen({ mode: 'hard', pairedTestExists: true, ranTest: false, red: false }).outcome, 'pass');
  assert.equal(evaluateRedGreen({ mode: 'hard', pairedTestExists: true, ranTest: true, red: true }).outcome, 'pass');
});

test('evaluateRedGreen：GREEN-before-impl → warn(默认) / block(hard)', () => {
  assert.equal(
    evaluateRedGreen({ mode: 'warn', pairedTestExists: true, ranTest: true, red: false }).outcome,
    'warn',
  );
  assert.equal(
    evaluateRedGreen({ mode: 'hard', pairedTestExists: true, ranTest: true, red: false }).outcome,
    'block',
  );
});

test('isHorizontalTddPlan：全部测试在前、全部实现在后 → true', () => {
  const horizontal = [
    s({ id: 'stage_test_write_a' }),
    s({ id: 'stage_test_write_b' }),
    s({ id: 'stage_impl_a' }),
    s({ id: 'stage_impl_b' }),
  ];
  assert.equal(isHorizontalTddPlan(horizontal), true);
});

test('isHorizontalTddPlan：一切片一循环交错 → false', () => {
  const interleaved = [
    s({ id: 'stage_test_write_a' }),
    s({ id: 'stage_impl_a' }),
    s({ id: 'stage_test_write_b' }),
    s({ id: 'stage_impl_b' }),
  ];
  assert.equal(isHorizontalTddPlan(interleaved), false);
});

test('isHorizontalTddPlan：少于 2 个切片不触发', () => {
  assert.equal(isHorizontalTddPlan([s({ id: 'stage_test_write_a' }), s({ id: 'stage_impl_a' })]), false);
});

test('verifyRule20：horizontal TDD 计划产出 horizontal-tdd warning', () => {
  const w = wf([
    s({ id: 'stage_test_write_a' }),
    s({ id: 'stage_test_write_b' }),
    s({ id: 'stage_impl_a' }),
    s({ id: 'stage_impl_b' }),
  ]);
  const res = verifyRule20(w);
  assert.ok(res.warnings.some((x) => x.type === 'horizontal-tdd'));
  assert.equal(res.passed, true);
});

test('verifyRule20：horizontalTddFail=true → horizontal-tdd 升 violation 并阻断（ADR-0009）', () => {
  const w = wf([
    s({ id: 'stage_test_write_a' }),
    s({ id: 'stage_test_write_b' }),
    s({ id: 'stage_impl_a' }),
    s({ id: 'stage_impl_b' }),
  ]);
  const res = verifyRule20(w, { horizontalTddFail: true });
  assert.ok(res.violations.some((x) => x.type === 'horizontal-tdd'));
  assert.ok(!res.warnings.some((x) => x.type === 'horizontal-tdd'));
  assert.equal(res.passed, false);
});

test('verifyRule20：horizontalTddFail=true 但计划非 horizontal → 不阻断', () => {
  const w = wf([
    s({ id: 'stage_test_write_a' }),
    s({ id: 'stage_impl_a' }),
    s({ id: 'stage_test_write_b' }),
    s({ id: 'stage_impl_b' }),
  ]);
  const res = verifyRule20(w, { horizontalTddFail: true });
  assert.ok(!res.violations.some((x) => x.type === 'horizontal-tdd'));
  assert.equal(res.passed, true);
});

test('verifyRule20(debug)：假设/修复排在复现之前 → debug-feedback-loop-not-first warning', () => {
  const w = wf(
    [
      s({ id: 'stage_hypothesis_debug_root_cause' }),
      s({ id: 'stage_impl_debug_fix' }),
      testRun('stage_test_run_debug_regression'),
    ],
    'debug',
  );
  const res = verifyRule20(w);
  assert.ok(res.warnings.some((x) => x.type === 'debug-feedback-loop-not-first'));
});

test('verifyRule20(debug)：复现在前则不报 feedback-loop-not-first', () => {
  const w = wf(
    [
      testRun('stage_reproduce_debug_case'),
      s({ id: 'stage_hypothesis_debug_root_cause' }),
      s({ id: 'stage_impl_debug_fix' }),
      testRun('stage_test_run_debug_regression'),
    ],
    'debug',
  );
  const res = verifyRule20(w);
  assert.ok(!res.warnings.some((x) => x.type === 'debug-feedback-loop-not-first'));
});
