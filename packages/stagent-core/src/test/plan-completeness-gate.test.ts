import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  hasExecutableVerificationStage,
  hasMainAssemblyStage,
  lintPlanCompleteness,
} from '../PlanCompletenessGate';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function impl(id: string, file: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function testRun(id: string, command: string): Stage {
  return {
    id,
    title: id,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command, captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function wf(stages: Stage[], taskType: WorkflowDefinition['meta']['taskType'] = 'prototype'): WorkflowDefinition {
  return { id: 'w', version: '2.0', meta: { title: 't', taskType, userInput: 'u', createdAt: '' }, stages };
}

test('复刻失败运行：无 test_run + 无 main → 同时报 missing-verification 与 missing-main-assembly', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_reader', 'reader.py'),
    impl('stage_impl_prototype_fetcher', 'fetcher.py'),
    impl('stage_impl_prototype_analyzer', 'analyzer.py'),
  ]);
  const issues = lintPlanCompleteness(w);
  const types = issues.map((i) => i.type);
  assert.ok(types.includes('missing-verification-stage'));
  assert.ok(types.includes('missing-main-assembly'));
});

test('完整计划：有 main + test_run → 无 issue', () => {
  const w = wf([
    impl('stage_impl_prototype_reader', 'reader.py'),
    impl('stage_impl_prototype_analyzer', 'analyzer.py'),
    impl('stage_impl_prototype_main', 'main.py'),
    testRun('stage_test_run_prototype_pipeline', 'python main.py --mock && python -c "assert 1"'),
  ]);
  const issues = lintPlanCompleteness(w);
  assert.ok(!issues.some((i) => i.type === 'missing-verification-stage'));
  assert.ok(!issues.some((i) => i.type === 'missing-main-assembly'));
});

test('单文件 spike 豁免（仅 1 个代码实现）', () => {
  const w = wf([impl('stage_impl_prototype_main', 'main.py')]);
  assert.deepEqual(lintPlanCompleteness(w), []);
});

test('软件任务同样适用', () => {
  const w = wf(
    [impl('stage_impl_a', 'a.py'), impl('stage_impl_b', 'b.py')],
    'software',
  );
  assert.ok(lintPlanCompleteness(w).some((i) => i.type === 'missing-verification-stage'));
});

test('非 prototype/software 不门控（如 debug）', () => {
  const w = wf([impl('stage_impl_x', 'x.py'), impl('stage_impl_y', 'y.py')], 'debug');
  assert.deepEqual(lintPlanCompleteness(w), []);
});

test('2 个代码实现但有 test_run：不报 verification；<3 不报 main-assembly', () => {
  const w = wf([
    impl('stage_impl_prototype_reader', 'reader.py'),
    impl('stage_impl_prototype_writer', 'writer.py'),
    testRun('stage_test_run_x', 'python -c "import reader; assert reader"'),
  ]);
  const issues = lintPlanCompleteness(w);
  assert.ok(!issues.some((i) => i.type === 'missing-verification-stage'));
  assert.ok(!issues.some((i) => i.type === 'missing-main-assembly'));
});

test('hasExecutableVerificationStage / hasMainAssemblyStage', () => {
  const noVerify = wf([impl('stage_impl_prototype_reader', 'reader.py')]);
  assert.equal(hasExecutableVerificationStage(noVerify), false);
  assert.equal(hasMainAssemblyStage(noVerify), false);

  const withMainImpl = wf([impl('stage_impl_prototype_main', 'main.py')]);
  assert.equal(hasMainAssemblyStage(withMainImpl), true);

  const withRunnerMain = wf([testRun('stage_test_run_pipe', 'python main.py')]);
  assert.equal(hasMainAssemblyStage(withRunnerMain), true);
  assert.equal(hasExecutableVerificationStage(withRunnerMain), true);
});
