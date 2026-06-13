/**
 * Golden fixture：T4 Live Run #48 generate 失败形态（外部落盘产物已被后续 run 清理，
 * 此处按 RCA 固化等价 plan 形态进仓库，供 sanitizeSemanticFillWorkflow 离线回归）：
 * - impl prompt 多文件暗示（`broker/core.py` 和 `broker/sim_broker.py` / `main/core.py` 和 `main/cli.py`）
 *   与 writeOutputToFile 单一目标冲突 → multi-file-prompt-mismatch；
 * - test_write prompt 使用 `from your_module.indicators import ...` 占位 →
 *   test-write-import-not-in-plan。
 */
import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';

function llmStage(opts: {
  id: string;
  systemPrompt: string;
  writeOutputToFile: string;
}): Stage {
  return {
    id: opts.id,
    title: opts.id,
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: opts.systemPrompt,
      writeOutputToFile: opts.writeOutputToFile,
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
}

export function buildRun48LikePlan(): WorkflowDefinition {
  return {
    id: 'run48-golden',
    version: '2.0',
    meta: {
      title: 'T4 Run #48 generate 失败形态',
      taskType: 'software',
      userInput: 'T4 量化策略 MVP',
      createdAt: '2026-06-05T00:00:00.000Z',
    },
    stages: [
      llmStage({
        id: 'stage_impl_indicators',
        systemPrompt:
          '请编写 GREEN 实现，文件路径 `indicators/__init__.py` 或 `indicators/core.py`，逐条实现指标计算。',
        writeOutputToFile: 'indicators/__init__.py',
      }),
      llmStage({
        id: 'stage_test_write_indicators',
        systemPrompt:
          '请编写 pytest 测试，仅导入 `from your_module.indicators import compute_indicators, IndicatorResult`，覆盖 MA/BOLL/CCI 行为。',
        writeOutputToFile: 'tests/test_indicators.py',
      }),
      llmStage({
        id: 'stage_impl_broker',
        systemPrompt:
          '请编写 GREEN 实现（`broker/core.py` 和 `broker/sim_broker.py`），实现模拟撮合与持仓管理。',
        writeOutputToFile: 'broker/__init__.py',
      }),
      llmStage({
        id: 'stage_impl_main',
        systemPrompt:
          '请编写 GREEN 实现（`main/core.py` 和 `main/cli.py`）：装配 indicators/signals/risk/broker 主流程。',
        writeOutputToFile: 'main.py',
      }),
    ],
  };
}
