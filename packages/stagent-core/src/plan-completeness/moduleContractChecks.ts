import type { InputSource, WorkflowDefinition } from '../WorkflowDefinition';
import { DECISION_ARTIFACTS_OUTPUT_KEY, PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { hasStageOutputSource } from '../workflow/StageInputSources';
import {
  decideStageIdFromSemanticName,
  isDecideStageId,
  isGlobalArchitectureDecideStageId,
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromImplStageId,
  semanticNameFromTestWriteStageId,
} from '../workflow/StageIdPatterns';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { isStagentBundleWriteStage } from '../WorkflowDiskBootstrap';
import { isSoftwareTaskType } from '../workflow/TaskType';
import { GLOBAL_CONFIG_DECIDE_STAGE_ID } from '../plan-skeleton/constants';
import { planCompletenessMsg } from '../l10n/lintMsg';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

function stageDeclaresOutputKey(stage: { outputs?: { key: string }[] }, key: string): boolean {
  return (stage.outputs ?? []).some((o) => o.key === key);
}

function isSliceDecideStageId(id: string): boolean {
  return isDecideStageId(id) && !isGlobalArchitectureDecideStageId(id);
}

function hasPairedSliceDecide(wf: WorkflowDefinition, semantic: string): boolean {
  const decideId = decideStageIdFromSemanticName(semantic);
  return (wf.stages ?? []).some((s) => s.id === decideId && s.isDecisionStage);
}

function shouldLintModuleContract(wf: WorkflowDefinition): boolean {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return false;
  }
  const stages = wf.stages ?? [];
  return stages.some((s) => isTestWriteStageId(s.id)) && stages.some((s) => isSliceDecideStageId(s.id));
}

/** 切片 decide 须声明 decisionArtifacts output（骨架 / greenfield_full）。 */
export function lintSliceDecideDeclaresDecisionArtifacts(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!shouldLintModuleContract(wf)) {
    return [];
  }
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages ?? []) {
    if (!stage.isDecisionStage || !isSliceDecideStageId(stage.id)) {
      continue;
    }
    if (!stageDeclaresOutputKey(stage, DECISION_ARTIFACTS_OUTPUT_KEY)) {
      issues.push({
        type: 'slice-decide-missing-decision-artifacts',
        message: planCompletenessMsg('slice-decide-missing-decision-artifacts', stage.id),
      });
    }
  }
  return issues;
}

/** 全局 architecture decide 须声明 decisionArtifacts output。 */
export function lintGlobalDecideDeclaresDecisionArtifacts(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!shouldLintModuleContract(wf)) {
    return [];
  }
  const global = (wf.stages ?? []).find((s) => s.id === GLOBAL_CONFIG_DECIDE_STAGE_ID);
  if (!global?.isDecisionStage) {
    return [];
  }
  if (!stageDeclaresOutputKey(global, DECISION_ARTIFACTS_OUTPUT_KEY)) {
    return [
      {
        type: 'global-decide-missing-decision-artifacts',
        message: planCompletenessMsg('global-decide-missing-decision-artifacts', global.id),
      },
    ];
  }
  return [];
}

function hasDecisionSource(
  stage: { input: { sources: InputSource[] } },
  decideId: string,
  outputKey: string,
): boolean {
  return hasStageOutputSource(stage.input.sources, { stageId: decideId, outputKey });
}

/** test_write 须接线配对 decide 的 decisionRecord + decisionArtifacts。 */
export function lintTestWriteWiredToModuleDecide(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!shouldLintModuleContract(wf)) {
    return [];
  }
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages ?? []) {
    if (!isTestWriteStageId(stage.id) || !isLlmTextTool(stage.tool)) {
      continue;
    }
    const semantic = semanticNameFromTestWriteStageId(stage.id);
    if (!semantic || !hasPairedSliceDecide(wf, semantic)) {
      continue;
    }
    const decideId = decideStageIdFromSemanticName(semantic);
    if (!hasDecisionSource(stage, decideId, PRIMARY_DECISION_OUTPUT_KEY)) {
      issues.push({
        type: 'test-write-missing-module-contract-source',
        message: planCompletenessMsg('test-write-missing-module-contract-source', stage.id, decideId),
      });
    }
    if (!hasDecisionSource(stage, decideId, DECISION_ARTIFACTS_OUTPUT_KEY)) {
      issues.push({
        type: 'test-write-missing-module-contract-source',
        message: planCompletenessMsg(
          'test-write-missing-module-contract-source',
          stage.id,
          `${decideId}#${DECISION_ARTIFACTS_OUTPUT_KEY}`,
        ),
      });
    }
  }
  return issues;
}

/** impl 须接线配对 decide 的 decisionRecord + decisionArtifacts。 */
export function lintImplWiredToModuleDecide(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!shouldLintModuleContract(wf)) {
    return [];
  }
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages ?? []) {
    if (
      !isImplStageId(stage.id) ||
      isStagentBundleWriteStage(stage) ||
      !isLlmTextTool(stage.tool) ||
      stage.exposeAssumptions
    ) {
      continue;
    }
    const semantic = semanticNameFromImplStageId(stage.id);
    if (!semantic || !hasPairedSliceDecide(wf, semantic)) {
      continue;
    }
    const decideId = decideStageIdFromSemanticName(semantic);
    if (!hasDecisionSource(stage, decideId, PRIMARY_DECISION_OUTPUT_KEY)) {
      issues.push({
        type: 'impl-missing-module-contract-source',
        message: planCompletenessMsg('impl-missing-module-contract-source', stage.id, decideId),
      });
    }
    if (!hasDecisionSource(stage, decideId, DECISION_ARTIFACTS_OUTPUT_KEY)) {
      issues.push({
        type: 'impl-missing-module-contract-source',
        message: planCompletenessMsg(
          'impl-missing-module-contract-source',
          stage.id,
          `${decideId}#${DECISION_ARTIFACTS_OUTPUT_KEY}`,
        ),
      });
    }
  }
  return issues;
}

export function lintModuleContractPlan(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  return [
    ...lintSliceDecideDeclaresDecisionArtifacts(wf),
    ...lintGlobalDecideDeclaresDecisionArtifacts(wf),
    ...lintTestWriteWiredToModuleDecide(wf),
    ...lintImplWiredToModuleDecide(wf),
  ];
}
