/**
 * M27.1：计划完整性硬门（薄 re-export；实现见 `plan-completeness/`）。
 */
export { hasExecutableVerificationStage } from './plan-completeness/stageChecks';
export type {
  PlanCompletenessIssue,
  PlanCompletenessViolationType,
} from './plan-completeness/planCompletenessTypes';
export {
  JS_TEST_RUN_CMD,
  PYTHON_TEST_RUN_CMD,
  matchesEntryOutputPath,
  matchesMainAssemblyCommand,
  matchesMainAssemblyStageId,
  codeImplStages,
  hasMainAssemblyStage,
} from './plan-completeness/mainAssemblyChecks';
export {
  EXPO_STACK_HINT,
  isJsTestRunCommand,
  isPythonOnlyTestRunCommand,
  firstTestRunStageIndex,
  hasTypeScriptOrJsxCodeImpls,
  planSignalsExpoStack,
  testInfrastructureArtifactsBefore,
  planRequiresTestInfrastructure,
  hasTestInfrastructureBeforeFirstTestRun,
  lintTestInfraPathAlignment,
} from './plan-completeness/testInfraChecks';
export { semanticOf } from './plan-completeness/planCompletenessStageAccess';
export { lintPlanCompleteness, formatPlanCompletenessBlockReason } from './plan-completeness/lintPlanCompleteness';
