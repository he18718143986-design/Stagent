import { lintPlanCompleteness, formatPlanCompletenessBlockReason } from '../PlanCompletenessGate';
import {
  applyPostLintStructuralRepairs,
  type StructuralRepairAction,
} from '../WorkflowStructuralRepair';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import { applyDiskBootstrap, validateWorkflowContract } from '../WorkflowEngineHelpers';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { PlanCompletenessIssue } from '../plan-completeness/planCompletenessTypes';
import type { StackProfile } from '../path-router/StackProfile';
import { lintArtifactGraphHard } from '../plan-preflight/artifactGraphPreflight';
import { sanitizeInfraStagesOnWorkflow } from './sanitizeInfraStages';
import type {
  PlanPreflightPhase,
  PlanPreflightResult,
  RunPlanPreflightOptions,
} from '../plan-preflight/PlanPreflightOrchestrator';

function resolveStackProfile(wf: WorkflowDefinition): StackProfile | undefined {
  const p = wf.globalConfig?.stackProfile;
  if (p === 'node' || p === 'python' || p === 'auto') {
    return p;
  }
  if (wf.globalConfig?.language?.trim().toLowerCase() === 'python') {
    return 'python';
  }
  return undefined;
}

function lintOrPass(wf: WorkflowDefinition, enabled: boolean): PlanCompletenessIssue[] {
  return enabled ? lintPlanCompleteness(wf) : [];
}

function mergeIssues(...groups: PlanCompletenessIssue[][]): PlanCompletenessIssue[] {
  return groups.flat();
}

/**
 * Plan Compiler 编排：sanitize → lint/repair → bootstrap → artifact graph → final lint。
 */
export function compilePlan(
  wf: WorkflowDefinition,
  options: RunPlanPreflightOptions,
): PlanPreflightResult {
  const contract = validateWorkflowContract(wf);
  if (contract.errors.length > 0) {
    return { contractFailed: true, workflow: wf, errors: contract.errors };
  }

  let repairs: StructuralRepairAction[] = [];
  let current = wf;
  const stackProfile = resolveStackProfile(current);

  if (options.fullOrchestration) {
    current = sanitizeInfraStagesOnWorkflow(current, stackProfile);
    current = options.normalizeWorkflow(current, options.userInput, options.taskType);
    const rawIssues = lintOrPass(current, options.planCompletenessEnabled);
    if (rawIssues.length > 0 && options.structuralRepairMode === 'auto') {
      const repairResult = applyPostLintStructuralRepairs(current, rawIssues, {
        mode: 'auto',
        userInput: options.userInput,
        taskType: options.taskType,
      });
      if (repairResult.changed) {
        repairs = repairResult.actions;
        current = options.normalizeWorkflow(repairResult.workflow, options.userInput, options.taskType);
      }
    }
    current = sanitizeInfraStagesOnWorkflow(current, stackProfile);
    current = applyDiskBootstrap(current, options.taskType);
  }

  const artifactIssues = lintArtifactGraphHard(current);
  let finalIssues = mergeIssues(
    artifactIssues,
    lintOrPass(current, options.planCompletenessEnabled),
  );

  if (finalIssues.length > 0 && options.structuralRepairMode === 'auto') {
    const repairResult = applyPostLintStructuralRepairs(current, finalIssues, {
      mode: 'auto',
      userInput: options.userInput,
      taskType: options.taskType,
    });
    if (repairResult.changed) {
      repairs = [...repairs, ...repairResult.actions];
      current = options.normalizeWorkflow(repairResult.workflow, options.userInput, options.taskType);
      current = sanitizeInfraStagesOnWorkflow(current, stackProfile);
      current = applyDiskBootstrap(current, options.taskType);
      finalIssues = mergeIssues(
        lintArtifactGraphHard(current),
        lintOrPass(current, options.planCompletenessEnabled),
      );
    }
  }

  const hardBlock = finalIssues.filter(
    (i) => i.type !== 'thin-llm-system-prompt',
  );

  if (hardBlock.length > 0) {
    return {
      blocked: true,
      workflow: current,
      issues: hardBlock,
      blockReasons: [formatPlanCompletenessBlockReason(hardBlock)],
      repairs,
      phase: 'final' as PlanPreflightPhase,
    };
  }

  return { ok: true, workflow: current, repairs, phase: 'final' };
}
