/**
 * Re-export shim：执行循环参数类型已拆分至 execution-bindings/executor-loop-types。
 */
export type {
  StageStepOutcome,
  CodeRunnerResult,
  PanelLike,
  ExecutionInstanceSlice,
  ExecutionMessagingSlice,
  ExecutionLlmSlice,
  ExecutionPathSlice,
  ExecutionControlSlice,
  ExecutionQualitySlice,
  NonLlmToolExecutionParams,
  ExecuteNextStageLoopParams,
} from './execution-bindings/executor-loop-types';
