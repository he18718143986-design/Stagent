import { confidenceReasonMsg } from '../l10n/qualityMsg';
import type { ConfidenceResult } from '../ConfidenceScorer';
import { isSmokeStageId } from '../disk-bootstrap/smokeStage';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import {
  CODE_RUNNER_EXIT_OUTPUT_KEY,
  CONFIDENCE_OUTPUT_KEY,
  VERIFICATION_RUNS_OUTPUT_KEY,
} from '../WorkflowOutputKeys';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import {
  confidenceScoreForFlakySummary,
  summarizeVerificationRuns,
  type VerificationRunRecord,
} from './verificationFlaky';
import { scoreToConfidenceLevel } from '../ConfidenceBands';

/** B-Q3：验证阶段 exit 0 时的置信先验（高于输出形态启发式）。 */
export const VERIFICATION_PASS_CONFIDENCE_SCORE = 0.92;

export function isVerificationStage(stage: Stage): boolean {
  return (
    isCodeRunnerTool(stage.tool) &&
    (isTestRunStageId(stage.id) || isSmokeStageId(stage.id))
  );
}

function readVerificationRuns(outputs: Record<string, unknown>): VerificationRunRecord[] {
  const raw = outputs[VERIFICATION_RUNS_OUTPUT_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (r): r is VerificationRunRecord =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as VerificationRunRecord).attempt === 'number' &&
      typeof (r as VerificationRunRecord).exitCode === 'number',
  );
}

/**
 * code-runner 的 test_run / smoke 成功退出时写入 _confidence（B-Q3）。
 * 结合 flaky 多跑摘要调整分数；已有 _confidence 时不覆盖（保留 LLM 阶段评分）。
 */
export function applyVerificationConfidence(
  stage: Stage,
  runtime: StageRuntime,
): ConfidenceResult | undefined {
  if (!isVerificationStage(stage)) {
    return undefined;
  }
  if (runtime.outputs[CONFIDENCE_OUTPUT_KEY]) {
    return undefined;
  }
  const exitCode = runtime.outputs[CODE_RUNNER_EXIT_OUTPUT_KEY];
  if (exitCode !== 0) {
    return undefined;
  }

  const runs = readVerificationRuns(runtime.outputs);
  const summary = summarizeVerificationRuns(
    runs.length > 0
      ? runs
      : [{ attempt: 1, exitCode: 0 }],
  );
  const reasons: string[] = [];
  if (summary.flaky) {
    reasons.push(confidenceReasonMsg('verificationFlaky', summary.passCount, summary.totalRuns));
  } else if (summary.stable) {
    reasons.push(
      summary.totalRuns > 1
        ? confidenceReasonMsg('verificationStableMultiRun', summary.totalRuns)
        : confidenceReasonMsg('verificationPassed'),
    );
  } else {
    reasons.push(confidenceReasonMsg('verificationPassed'));
  }

  const score = confidenceScoreForFlakySummary(summary);
  const result: ConfidenceResult = {
    score,
    level: scoreToConfidenceLevel(score),
    reasons,
  };
  runtime.outputs[CONFIDENCE_OUTPUT_KEY] = result;
  return result;
}
