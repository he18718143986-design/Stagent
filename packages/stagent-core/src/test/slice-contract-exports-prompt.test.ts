import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import {
  buildCrossModulePatchExportsPromptSuffix,
  buildSliceContractExportsPromptSuffix,
  resolveSliceContractExports,
} from '../commitment/sliceContractExports';

function llmStage(id: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'exports已确定为：SignalGenerator' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
}

const baseMeta = {
  title: 't',
  taskType: 'software' as const,
  userInput: 'x',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SIGNALS_RECORD = [
  '### 关键设计决策',
  '2. **信号生成逻辑**：主方法 `generate` 组合结果。',
  "4. **信号返回值**：返回字典 {'type':'long'/'short'/'none', 'strength':int(0~3)}",
].join('\n');

test('resolveSliceContractExports uses synthesized exports not skeleton SignalGenerator', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [llmStage('stage_test_write_signals')],
  };
  const runtimes = [
    {
      stageId: 'stage_decide_signals',
      status: 'done' as const,
      outputs: {
        decisionRecord: SIGNALS_RECORD,
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'signals', exports: ['generate'] }],
        },
      },
      retryCount: 0,
    },
  ];
  assert.deepEqual(resolveSliceContractExports(wf, runtimes, 'signals'), ['generate']);
});

test('buildSliceContractExportsPromptSuffix overrides static skeleton exports example', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [llmStage('stage_test_write_signals')],
  };
  const runtimes = [
    {
      stageId: 'stage_decide_signals',
      status: 'done' as const,
      outputs: {
        decisionRecord: SIGNALS_RECORD,
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'signals', exports: ['generate'] }],
        },
      },
      retryCount: 0,
    },
  ];
  const suffix = buildSliceContractExportsPromptSuffix(wf, runtimes, wf.stages[0]!);
  assert.ok(suffix?.includes('覆盖 systemPrompt'));
  assert.ok(suffix?.includes('- generate'));
  assert.ok(suffix?.includes('from signals import'));
  assert.ok(!suffix?.includes('SignalGenerator'));
});

test('buildSliceContractExportsPromptSuffix impl 含 export 表面规则（Run #26）', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [llmStage('stage_impl_main')],
  };
  wf.stages[0]!.id = 'stage_impl_main';
  const runtimes = [
    {
      stageId: 'stage_decide_main',
      status: 'done' as const,
      outputs: {
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'main', exports: ['run', 'main', 'load_config', 'create_pipeline'] }],
        },
      },
      retryCount: 0,
    },
  ];
  const suffix = buildSliceContractExportsPromptSuffix(wf, runtimes, wf.stages[0]!);
  assert.ok(suffix?.includes('DataPipeline'));
  assert.ok(suffix?.includes('`_` 前缀'));
});

test('buildCrossModulePatchExportsPromptSuffix lists peer module exports for main test_write（Run #49）', () => {
  const wf: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: baseMeta,
    stages: [
      llmStage('stage_test_write_main'),
      { ...llmStage('stage_impl_indicators'), id: 'stage_impl_indicators' },
      { ...llmStage('stage_impl_signals'), id: 'stage_impl_signals' },
    ],
  };
  const runtimes = [
    {
      stageId: 'stage_decide_indicators',
      status: 'done' as const,
      outputs: {
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'indicators', exports: ['MA', 'BOLL', 'VOL'] }],
        },
      },
      retryCount: 0,
    },
    {
      stageId: 'stage_decide_signals',
      status: 'done' as const,
      outputs: {
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'signals', exports: ['SignalDetector'] }],
        },
      },
      retryCount: 0,
    },
    {
      stageId: 'stage_decide_main',
      status: 'done' as const,
      outputs: {
        decisionArtifacts: {
          version: 1,
          files: [],
          modules: [{ name: 'main', exports: ['run_trading_loop', 'parse_args'] }],
        },
      },
      retryCount: 0,
    },
  ];
  const suffix = buildCrossModulePatchExportsPromptSuffix(wf, runtimes, wf.stages[0]!);
  assert.ok(suffix?.includes('- indicators:'));
  assert.ok(suffix?.includes('MA'));
  assert.ok(suffix?.includes('BOLL'));
  assert.ok(suffix?.includes('patch("indicators.'));
  assert.ok(suffix?.includes('signals: SignalDetector'));
  assert.ok(suffix?.includes('禁止 patch compute'));
});
