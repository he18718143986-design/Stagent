/**
 * M30-F1：执行循环参数绑定层 — 从 WorkflowEngine 抽出 executeNextStageLoop 入参组装。
 */
import type * as vscode from './platform/HostTypes';
import type { ExecuteNextStageLoopParams } from './WorkflowExecutor';
import { evaluateSkipCondition } from './WorkflowSkipCondition';
import { WorkflowParallelMonitor } from './WorkflowParallelMonitor';
import { buildDagBindings, buildLlmIoBindings } from './execution-bindings/llm-io';
import { buildMessagingBindings } from './execution-bindings/messaging';
import { buildQualityGateBindings } from './execution-bindings/quality-gates';
export type {
  ExecutionLlmHost,
  ExecutionMessagingHost,
  ExecutionPathHost,
  ExecutionQualityHost,
  WorkflowEngineExecutionHost,
} from './execution-bindings/types';

import type { WorkflowEngineExecutionHost } from './execution-bindings/types';

export function buildExecuteNextStageLoopParams(
  engine: WorkflowEngineExecutionHost,
  targetPanel: vscode.WebviewPanel,
  parallelMonitor: WorkflowParallelMonitor,
): ExecuteNextStageLoopParams {
  if (!engine.instance) {
    throw new Error('buildExecuteNextStageLoopParams: instance is required');
  }
  return {
    instance: engine.instance,
    panel: targetPanel,
    evaluateSkipCondition,
    ...buildMessagingBindings(engine, targetPanel, parallelMonitor),
    ...buildLlmIoBindings(engine, targetPanel),
    ...buildDagBindings(engine),
    ...buildQualityGateBindings(engine, targetPanel),
  };
}
