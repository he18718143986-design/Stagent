import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isContractNode, isDataContractSourceStage } from '../HITLContractNodePolicy';
import { detectUnsharedSampleMockSource } from '../PrototypeContractLint';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function impl(id: string, file: string, sources: Stage['input']['sources'] = []): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file },
    input: { sources, mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

function wf(stages: Stage[]): WorkflowDefinition {
  return { id: 'w', version: '2.0', meta: { title: 't', taskType: 'prototype', userInput: 'u', createdAt: '' }, stages };
}

test('P0-2a：create_sample / mock_data 现在被识别为数据契约源', () => {
  assert.equal(isDataContractSourceStage(impl('stage_impl_prototype_create_sample', 'create_sample.py')), true);
  assert.equal(isDataContractSourceStage(impl('stage_impl_prototype_mock_data', 'mock_data.json')), true);
  assert.equal(isDataContractSourceStage(impl('stage_impl_prototype_schema', 'schema.py')), true);
  // 配置/依赖类不算契约源
  assert.equal(isDataContractSourceStage(impl('stage_impl_prototype_requirements', 'requirements.txt')), false);
  assert.equal(isDataContractSourceStage(impl('stage_impl_prototype_config_yaml', 'config.yaml')), false);
});

test('P0-2a：契约节点检测把 create_sample / mock_data 纳入（无 stage-output 边也算）', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_mock_data', 'mock_data.json'),
    impl('stage_impl_prototype_config_yaml', 'config.yaml'),
  ]);
  assert.equal(isContractNode(w, w.stages[0]), true, 'create_sample 应为契约节点');
  assert.equal(isContractNode(w, w.stages[1]), true, 'mock_data 应为契约节点');
  assert.equal(isContractNode(w, w.stages[2]), false, 'config 仍非契约节点');
});

test('P0-2b：create_sample 与 mock_data 无共享边 → detectUnsharedSampleMockSource 返回 mockData id', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_mock_data', 'mock_data.json'),
  ]);
  assert.equal(detectUnsharedSampleMockSource(w), 'stage_impl_prototype_mock_data');
});

test('P0-2b：mock_data 通过 input.sources 引用 create_sample → 视为已共享（undefined）', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_mock_data', 'mock_data.json', [
      { type: 'stage-output', stageId: 'stage_impl_prototype_create_sample', outputKey: 'text' },
    ]),
  ]);
  assert.equal(detectUnsharedSampleMockSource(w), undefined);
});

test('P0-2b：无 create_sample 或无 mock_data → 不适用（undefined）', () => {
  const w = wf([impl('stage_impl_prototype_reader', 'reader.py')]);
  assert.equal(detectUnsharedSampleMockSource(w), undefined);
});

function codeRunner(id: string, command: string, title = id): Stage {
  return {
    id,
    title,
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command, captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
}

test('P0-2b：文件中介（执行 create_sample + 读取 ASIN 列表桥接）视为已共享（undefined）', () => {
  // 复刻用户实际计划：create_sample.py → 执行 → 读取 ASIN 列表 → mock_data.json（无直接 stage-output 边）
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    codeRunner('stage_test_run_prototype_exec_sample', 'python create_sample.py', '执行 create_sample.py'),
    codeRunner('stage_test_run_prototype_read_asin', "python -c \"import openpyxl; print('asin list')\"", '读取 ASIN 列表'),
    impl('stage_impl_prototype_mock_data', 'mock_data.json'),
  ]);
  assert.equal(detectUnsharedSampleMockSource(w), undefined, '存在 ASIN 桥接 code-runner 时不应阻断');
});

test('P0-2b：传递依赖可达（经中间阶段 input.sources 链）视为已共享（undefined）', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_asin_list', 'asin_list.py', [
      { type: 'stage-output', stageId: 'stage_impl_prototype_create_sample', outputKey: 'text' },
    ]),
    impl('stage_impl_prototype_mock_data', 'mock_data.json', [
      { type: 'stage-output', stageId: 'stage_impl_prototype_asin_list', outputKey: 'text' },
    ]),
  ]);
  assert.equal(detectUnsharedSampleMockSource(w), undefined);
});

test('P0-2b：真正无关联（无边/无桥接）仍阻断', () => {
  const w = wf([
    impl('stage_impl_prototype_create_sample', 'create_sample.py'),
    impl('stage_impl_prototype_reader', 'reader.py'),
    impl('stage_impl_prototype_mock_data', 'mock_data.json'),
  ]);
  assert.equal(detectUnsharedSampleMockSource(w), 'stage_impl_prototype_mock_data');
});
