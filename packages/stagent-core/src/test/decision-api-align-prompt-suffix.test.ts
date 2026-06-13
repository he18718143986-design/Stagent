import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import {
  buildApiAlignPromptSuffix,
  extractApiSymbolsFromImplPrompt,
  parsePublicApiSymbolsFromText,
} from '../stage-runners/llm-persist/decisionApiAlignPromptSuffix';

function llmStage(id: string, file: string, prompt: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: prompt, writeOutputToFile: file },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

const baseMeta = {
  title: 't',
  taskType: 'software' as const,
  userInput: 'x',
  createdAt: '2026-01-01T00:00:00.000Z',
};

test('extractApiSymbolsFromImplPrompt reads T4-style impl bullet list', () => {
  const prompt = [
    '- 包含以下类/函数（内联）：',
    '  - 指标计算：moving_average, bollinger, volume, macd, cci（参数按需求）。',
    '  - 信号判断：空信号 check_short_signal(), 多信号 check_long_signal()（3分钟周期）。',
    '  - 模拟券商：class SimBroker（依赖 BrokerAdapter 抽象）。',
  ].join('\n');
  const symbols = extractApiSymbolsFromImplPrompt(prompt);
  assert.ok(symbols.includes('moving_average'));
  assert.ok(symbols.includes('bollinger'));
  assert.ok(symbols.includes('check_short_signal'));
  assert.ok(symbols.includes('SimBroker'));
  assert.ok(!symbols.includes('calculate_ma'));
});

test('parsePublicApiSymbolsFromText reads MODULE_CONTRACT lines', () => {
  const text = 'MODULE_CONTRACT: main.moving_average(data, period) -> list[float]';
  assert.deepEqual(parsePublicApiSymbolsFromText(text), ['moving_average']);
});

test('buildApiAlignPromptSuffix lists impl APIs for test_write and forbids aliases', () => {
  const implPrompt = '指标计算：moving_average, bollinger, macd, cci';
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmStage('stage_impl_main', 'main.py', implPrompt),
      llmStage('stage_test_write_main', 'tests/test_core.py', 'write tests'),
    ],
  };
  const suffix = buildApiAlignPromptSuffix(wf, [], wf.stages[1]!);
  assert.ok(suffix?.includes('moving_average'));
  assert.ok(suffix?.includes('禁止 calculate_ma'));
  assert.ok(suffix?.includes('from main import'));
});

test('buildApiAlignPromptSuffix uses semantic module name for indicators/__init__.py', () => {
  const implPrompt = '指标：compute_ma, compute_boll';
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmStage('stage_impl_indicators', 'indicators/__init__.py', implPrompt),
      llmStage('stage_test_write_indicators', 'tests/test_indicators.py', 'write tests'),
    ],
  };
  const suffix = buildApiAlignPromptSuffix(wf, [], wf.stages[1]!);
  assert.ok(suffix?.includes('from indicators import'));
  assert.ok(suffix?.includes('测试 import 目标：from indicators import'));
  assert.ok(suffix?.includes('indicators/__init__.py'));
  assert.ok(suffix?.includes('禁止 from __init__ import'));
});
