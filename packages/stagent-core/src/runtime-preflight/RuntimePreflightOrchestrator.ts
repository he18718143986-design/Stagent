import { COMMITMENT_SNAPSHOT_OUTPUT_KEY } from '../commitment';
import type { CommitmentSnapshot } from '../commitment';
import { detectPythonInfraPlanIssues } from '../contract-infra';
import { GATE_ID_PYTHON_VENV_BOOTSTRAP, GATE_ID_TEST_RUN_PREFLIGHT } from '../QualityGateIds';
import type { MissingPythonTestInfraIssue } from '../test-infra/missingPythonInfraIssue';
import { writeOutputToFileOf } from '../workflow/StageToolConfigAccess';
import { isImplStageId, isTestRunStageId } from '../workflow/StageIdPatterns';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { buildPreflightConftestTrigger, buildPreflightPytestAsyncioTrigger } from '../runtime-replan/PreflightReplanRouter';
import type { RuntimePreflightOutcome } from './types';

export type RuntimePreflightWhen = 'before-impl' | 'before-test-run';

function findDecisionStageForImpl(
  definition: WorkflowInstance['definition'],
  implStageId: string,
): string | undefined {
  const semantic = implStageId.replace(/^stage_impl_/, '');
  const decideId = `stage_decide_${semantic}`;
  if (definition.stages.some((s) => s.id === decideId)) {
    return decideId;
  }
  return definition.stages.find((s) => s.isDecisionStage)?.id;
}

function evaluateDecisionLayer(
  instance: WorkflowInstance,
  stage: Stage,
): RuntimePreflightOutcome {
  if (!isImplStageId(stage.id)) {
    return { action: 'continue' };
  }
  const writeTarget = writeOutputToFileOf(stage)?.trim();
  if (!writeTarget) {
    return { action: 'continue' };
  }
  const decideId = findDecisionStageForImpl(instance.definition, stage.id);
  if (!decideId) {
    return { action: 'continue' };
  }
  const decideRt = instance.stageRuntimes.find((rt) => rt.stageId === decideId);
  const raw = decideRt?.outputs[COMMITMENT_SNAPSHOT_OUTPUT_KEY];
  if (!raw || typeof raw !== 'object') {
    return {
      action: 'reopen_decision',
      stageId: decideId,
      reason: `impl 落盘 ${writeTarget} 但决策阶段无 CommitmentSnapshot`,
    };
  }
  const snapshot = raw as CommitmentSnapshot;
  const declared = snapshot.commitments.some(
    (c) => c.kind === 'file_path' && c.subject.replace(/\\/g, '/') === writeTarget.replace(/\\/g, '/'),
  );
  if (!declared) {
    return {
      action: 'reopen_decision',
      stageId: decideId,
      reason: `CommitmentSnapshot 未声明 file_path: ${writeTarget}`,
    };
  }
  return { action: 'continue' };
}

function evaluatePlanLayer(instance: WorkflowInstance, testRunStage: Stage): RuntimePreflightOutcome {
  const issues = detectPythonInfraPlanIssues(instance.definition);
  const testRunIdx = instance.definition.stages.findIndex((s) => s.id === testRunStage.id);
  const relevant = issues.filter((i) => {
    if (i.stageId && testRunIdx >= 0) {
      const issueIdx = instance.definition.stages.findIndex((s) => s.id === i.stageId);
      return issueIdx < 0 || issueIdx <= testRunIdx;
    }
    return true;
  });
  if (relevant.length === 0) {
    return { action: 'continue' };
  }
  const venvMissing = relevant.some((i) => i.kind === 'missing-python-venv-chain');
  if (venvMissing) {
    return {
      action: 'bootstrap',
      gateId: GATE_ID_PYTHON_VENV_BOOTSTRAP,
      messages: relevant.map((i) => i.message),
    };
  }
  return {
    action: 'escalate_confirm',
    issues: relevant.map((i) => i.message),
  };
}

function evaluateDiskLayerFromPreflightIssue(
  testRunStageId: string,
  issue: MissingPythonTestInfraIssue,
): RuntimePreflightOutcome {
  if (issue.code === 'missing-python-venv') {
    return {
      action: 'bootstrap',
      gateId: GATE_ID_PYTHON_VENV_BOOTSTRAP,
      messages: [issue.message],
    };
  }
  if (issue.code === 'missing-python-flat-layout') {
    const trigger = buildPreflightConftestTrigger(testRunStageId);
    if (trigger) {
      return { action: 'replan', trigger };
    }
  }
  if (issue.code === 'missing-pytest-asyncio') {
    const trigger = buildPreflightPytestAsyncioTrigger(testRunStageId);
    if (trigger) {
      return { action: 'replan', trigger };
    }
  }
  return {
    action: 'escalate_confirm',
    issues: [issue.message],
  };
}

export function runRuntimePreflight(params: {
  instance: WorkflowInstance;
  stage: Stage;
  when: RuntimePreflightWhen;
  preflightIssue?: MissingPythonTestInfraIssue;
}): RuntimePreflightOutcome {
  const { instance, stage, when, preflightIssue } = params;

  if (when === 'before-impl') {
    return evaluateDecisionLayer(instance, stage);
  }

  if (!isTestRunStageId(stage.id)) {
    return { action: 'continue' };
  }

  const plan = evaluatePlanLayer(instance, stage);
  if (plan.action !== 'continue') {
    return plan;
  }

  if (preflightIssue) {
    return evaluateDiskLayerFromPreflightIssue(stage.id, preflightIssue);
  }

  return { action: 'continue' };
}
