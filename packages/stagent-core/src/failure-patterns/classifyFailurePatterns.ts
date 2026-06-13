import { DEFAULT_CONFIDENCE_PAUSE_THRESHOLD } from '../StagentSettingsDefaults';
import type { ErrorType } from '../WorkflowDefinition';
import type { FailurePattern } from '../WorkflowExperienceStore';
import type { ActionablePatternKind } from './types';

export interface ActionableFailurePattern extends FailurePattern {
  kind: ActionablePatternKind;
  recommendation: string;
}

export interface FailureAnalysisReport {
  totalExperiences: number;
  failedCount: number;
  patterns: ActionableFailurePattern[];
  topFailureStages: Array<{ stageId: string; count: number }>;
}
import type { WorkflowExperience } from '../WorkflowExperienceStore';
import { stageIdPrefixForExperience } from '../StageIdPrefix';
import { FAILURE_PATTERN_TOP_STAGES_MAX } from '../UiListLimits';
import { FAILURE_PATTERN_HIGH_HITL_INTERVENTIONS_MIN } from './constants';
import { DEFAULT_ERROR_BUCKET_RULE, ERROR_BUCKET_RULES } from './rules';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

function classifyErrorBucket(
  errorType: ErrorType,
  prefix: string,
): { kind: ActionablePatternKind; recommendation: string } {
  for (const rule of ERROR_BUCKET_RULES) {
    if (rule.match(errorType, prefix)) {
      return { kind: rule.kind, recommendation: rule.recommendation };
    }
  }
  return { kind: DEFAULT_ERROR_BUCKET_RULE.kind, recommendation: DEFAULT_ERROR_BUCKET_RULE.recommendation };
}

export function classifyErrorBucketPatterns(failed: WorkflowExperience[]): ActionableFailurePattern[] {
  const errorBuckets = new Map<string, number>();
  for (const exp of failed) {
    const key = `${exp.failureErrorType ?? 'unknown'}::${stageIdPrefixForExperience(exp.failureStageId ?? 'unknown')}`;
    errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
  }

  const patterns: ActionableFailurePattern[] = [];
  for (const [key, frequency] of errorBuckets.entries()) {
    const [errorType, prefix] = key.split('::') as [ErrorType, string];
    const { kind, recommendation } = classifyErrorBucket(errorType, prefix);
    patterns.push({
      patternId: key,
      frequency,
      stageIdPattern: prefix,
      errorType,
      commonContext: `errorType=${errorType}`,
      kind,
      recommendation,
    });
  }
  return patterns;
}

export function classifyAggregatePatterns(experiences: WorkflowExperience[]): ActionableFailurePattern[] {
  const patterns: ActionableFailurePattern[] = [];

  const lowConfidenceRuns = experiences.filter((e) =>
    (e.stageOutcomes ?? []).some(
      (o) =>
        typeof o.confidenceScore === 'number' && o.confidenceScore < DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
    ),
  );
  if (lowConfidenceRuns.length >= 2) {
    patterns.push({
      patternId: 'low-confidence-cluster',
      frequency: lowConfidenceRuns.length,
      stageIdPattern: 'stage_*',
      errorType: 'unknown',
      commonContext: `confidenceScore<${DEFAULT_CONFIDENCE_PAUSE_THRESHOLD}`,
      kind: 'low-confidence-cluster',
      recommendation: '调低 pauseThreshold 或加强决策/impl prompt；查看 stageConfidenceUpdate 日志',
    });
  }

  const highHitl = experiences.filter((e) => (e.humanInterventions ?? 0) >= FAILURE_PATTERN_HIGH_HITL_INTERVENTIONS_MIN);
  if (highHitl.length >= 2) {
    patterns.push({
      patternId: 'high-hitl-burden',
      frequency: highHitl.length,
      stageIdPattern: WORKFLOW_LEVEL_STAGE_ID,
      errorType: 'unknown',
      commonContext: `humanInterventions>=${FAILURE_PATTERN_HIGH_HITL_INTERVENTIONS_MIN}`,
      kind: 'high-hitl-burden',
      recommendation: '考虑拆分垂直切片或减少 pauseAfter；检查 AdaptiveHITL 阈值',
    });
  }

  const abandoned = experiences.filter((e) => e.completionStatus === 'abandoned');
  if (abandoned.length >= 1) {
    patterns.push({
      patternId: 'workflow-abandon',
      frequency: abandoned.length,
      stageIdPattern: WORKFLOW_LEVEL_STAGE_ID,
      errorType: 'unknown',
      commonContext: 'completionStatus=abandoned',
      kind: 'workflow-abandon',
      recommendation: '复盘失败阶段与决策清单是否充分',
    });
  }

  return patterns;
}

export function buildFailureAnalysisReport(experiences: WorkflowExperience[]): FailureAnalysisReport {
  const failed = experiences.filter((e) => e.completionStatus === 'failed');
  const stageCounts = new Map<string, number>();

  for (const exp of failed) {
    const sid = exp.failureStageId ?? 'unknown';
    stageCounts.set(sid, (stageCounts.get(sid) ?? 0) + 1);
  }

  const patterns = [
    ...classifyErrorBucketPatterns(failed),
    ...classifyAggregatePatterns(experiences),
  ];
  patterns.sort((a, b) => b.frequency - a.frequency);

  const topFailureStages = [...stageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FAILURE_PATTERN_TOP_STAGES_MAX)
    .map(([stageId, count]) => ({ stageId, count }));

  return {
    totalExperiences: experiences.length,
    failedCount: failed.length,
    patterns,
    topFailureStages,
  };
}
