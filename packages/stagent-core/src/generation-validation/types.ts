import type { DependencyGraph } from '../DependencyGraphAnalyzer';
import type { ComplexityEstimate } from '../WorkflowComplexityEstimator';
import type { PlanSummary, StageSourceEdge } from '../WorkflowPlanSummary';
import type { StructuralRepairAction } from '../WorkflowStructuralRepair';
import type { VerifyResult } from '../Rule20Verify';
import type { WorkflowDefinition } from '../WorkflowDefinition';

/** 生成后门禁设置（由引擎从 StagentSettings 读取后注入，便于 orchestrator 单测）。 */
export interface GenerationGateSettings {
  toIssuesHorizontalLayeringFail: boolean;
  /** ADR-0009：horizontal TDD 反模式升 hard（默认 false=warning）。 */
  horizontalTddFail?: boolean;
  debugFeedbackLoopMode: 'off' | 'warn' | 'hard';
  planCompletenessEnabled: boolean;
  planStructuralRepairMode: 'off' | 'auto';
  staticAnalysisEnabled: boolean;
  contractPlanPreflightV2: boolean;
}

export type GenerationValidationOutcome =
  | { kind: 'superseded' }
  | { kind: 'validation-errors'; workflow: WorkflowDefinition; errors: string[] }
  | {
      kind: 'rule20-blocked';
      workflow: WorkflowDefinition;
      blockReasons: string[];
      structuralRepairs?: StructuralRepairAction[];
    }
  | {
      kind: 'plan-blocked';
      workflow: WorkflowDefinition;
      blockReasons: string[];
      structuralRepairs: StructuralRepairAction[];
    }
  | {
      kind: 'success';
      workflow: WorkflowDefinition;
      warnings: string[];
      warningsDisplay: string[];
      planSummary: PlanSummary;
      stageSourceSummary: StageSourceEdge[];
      structuralRepairs: StructuralRepairAction[];
      verifyResult?: VerifyResult;
      runtimeRule20On: boolean;
    };

export interface OrchestratePostParseValidationParams {
  wf: WorkflowDefinition;
  effectiveType: string;
  uiTaskType: string;
  modelTaskType?: string;
  userInput: string;
  taskWorkspaceAbs: string;
  depGraph: DependencyGraph;
  complexity: ComplexityEstimate;
  gates: GenerationGateSettings;
  runtimeRule20On: boolean;
  maxStageWarn: number;
  normalizeWorkflow: (wf: WorkflowDefinition, userInput: string, taskType: string) => WorkflowDefinition;
  isSuperseded: () => boolean;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
}

export interface PipelineContext {
  wf: WorkflowDefinition;
  effectiveType: string;
  uiTaskType: string;
  modelTaskType?: string;
  userInput: string;
  taskWorkspaceAbs: string;
  depGraph: DependencyGraph;
  complexity: ComplexityEstimate;
  gates: GenerationGateSettings;
  runtimeRule20On: boolean;
  maxStageWarn: number;
  normalizeWorkflow: OrchestratePostParseValidationParams['normalizeWorkflow'];
  isSuperseded: OrchestratePostParseValidationParams['isSuperseded'];
  debugLog: OrchestratePostParseValidationParams['debugLog'];
}

export function buildPipelineContext(params: OrchestratePostParseValidationParams): PipelineContext {
  return {
    wf: params.wf,
    effectiveType: params.effectiveType,
    uiTaskType: params.uiTaskType,
    modelTaskType: params.modelTaskType,
    userInput: params.userInput,
    taskWorkspaceAbs: params.taskWorkspaceAbs,
    depGraph: params.depGraph,
    complexity: params.complexity,
    gates: params.gates,
    runtimeRule20On: params.runtimeRule20On,
    maxStageWarn: params.maxStageWarn,
    normalizeWorkflow: params.normalizeWorkflow,
    isSuperseded: params.isSuperseded,
    debugLog: params.debugLog,
  };
}
