import type { ErrorType } from './WorkflowDefinition';
import type { FailurePattern, WorkflowExperience } from './WorkflowExperienceStore';

export type ActionablePatternKind =
  | 'stage-impl-failure'
  | 'decision-retry-heavy'
  | 'code-runner-timeout-cluster'
  | 'low-confidence-cluster'
  | 'high-hitl-burden'
  | 'workflow-abandon'
  | 'test-run-import-missing-artifact';

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

function stageIdPrefix(stageId: string): string {
  const m = stageId.match(/^(stage_(?:impl|decide|test_(?:run|write))_[^_]+)/);
  return m?.[1] ?? stageId.split('_').slice(0, 3).join('_');
}

export function analyzeFailurePatterns(experiences: WorkflowExperience[]): FailureAnalysisReport {
  const failed = experiences.filter((e) => e.completionStatus === 'failed');
  const patterns: ActionableFailurePattern[] = [];
  const stageCounts = new Map<string, number>();

  for (const exp of failed) {
    const sid = exp.failureStageId ?? 'unknown';
    stageCounts.set(sid, (stageCounts.get(sid) ?? 0) + 1);
  }

  const errorBuckets = new Map<string, number>();
  for (const exp of failed) {
    const key = `${exp.failureErrorType ?? 'unknown'}::${stageIdPrefix(exp.failureStageId ?? 'unknown')}`;
    errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
  }

  for (const [key, frequency] of errorBuckets.entries()) {
    const [errorType, prefix] = key.split('::') as [ErrorType, string];
    let kind: ActionablePatternKind = 'stage-impl-failure';
    let recommendation = '检查该阶段 systemPrompt 与输入上下文是否完整';
    if (errorType === 'code-runner-timeout') {
      kind = 'code-runner-timeout-cluster';
      recommendation = '缩短 code-runner 命令或提高 timeout；考虑拆分验证阶段';
    } else if (
      errorType === 'tool-execution-failed' &&
      prefix.includes('test_run')
    ) {
      kind = 'test-run-import-missing-artifact';
      recommendation =
        'stage_test_run 命令 import 了未落盘模块或脚本路径不在 writeOutputToFile 登记内；' +
        '生成器须遵守 ARTIFACT_REGISTRY：仅有 config.yaml 时禁止 from config import；' +
        '对齐 reader.py/fetcher.py 等 artifact 后再写 python -c';
    } else if (prefix.includes('decide')) {
      kind = 'decision-retry-heavy';
      recommendation = '强化决策阶段 Rule 20 四节约束；检查 enableDecisionContentLint';
    } else if (errorType === 'llm-invalid-output' || errorType === 'tool-execution-failed') {
      kind = 'stage-impl-failure';
      recommendation = '检查 impl 输出是否空洞；启用 OutputQualityScorer 观测';
    }
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

  const lowConfidenceRuns = experiences.filter((e) =>
    (e.stageOutcomes ?? []).some((o) => typeof o.confidenceScore === 'number' && o.confidenceScore < 0.4),
  );
  if (lowConfidenceRuns.length >= 2) {
    patterns.push({
      patternId: 'low-confidence-cluster',
      frequency: lowConfidenceRuns.length,
      stageIdPattern: 'stage_*',
      errorType: 'unknown',
      commonContext: 'confidenceScore<0.4',
      kind: 'low-confidence-cluster',
      recommendation: '调低 pauseThreshold 或加强决策/impl prompt；查看 stageConfidenceUpdate 日志',
    });
  }

  const highHitl = experiences.filter((e) => (e.humanInterventions ?? 0) >= 5);
  if (highHitl.length >= 2) {
    patterns.push({
      patternId: 'high-hitl-burden',
      frequency: highHitl.length,
      stageIdPattern: 'workflow',
      errorType: 'unknown',
      commonContext: 'humanInterventions>=5',
      kind: 'high-hitl-burden',
      recommendation: '考虑拆分垂直切片或减少 pauseAfter；检查 AdaptiveHITL 阈值',
    });
  }

  const abandoned = experiences.filter((e) => e.completionStatus === 'abandoned');
  if (abandoned.length >= 1) {
    patterns.push({
      patternId: 'workflow-abandon',
      frequency: abandoned.length,
      stageIdPattern: 'workflow',
      errorType: 'unknown',
      commonContext: 'completionStatus=abandoned',
      kind: 'workflow-abandon',
      recommendation: '复盘失败阶段与决策清单是否充分',
    });
  }

  patterns.sort((a, b) => b.frequency - a.frequency);

  const topFailureStages = [...stageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([stageId, count]) => ({ stageId, count }));

  return {
    totalExperiences: experiences.length,
    failedCount: failed.length,
    patterns,
    topFailureStages,
  };
}

export function formatFailureAnalysisMarkdown(report: FailureAnalysisReport): string {
  const lines: string[] = [
    '# Stagent Experience Analysis',
    '',
    `- Total experiences: ${report.totalExperiences}`,
    `- Failed runs: ${report.failedCount}`,
    `- Actionable pattern kinds: ${new Set(report.patterns.map((p) => p.kind)).size}`,
    '',
    '## Top failure stages',
  ];
  for (const row of report.topFailureStages) {
    lines.push(`- ${row.stageId}: ${row.count}`);
  }
  lines.push('', '## Actionable patterns');
  for (const p of report.patterns.slice(0, 20)) {
    lines.push(`### ${p.kind} (${p.frequency}x)`);
    lines.push(`- patternId: ${p.patternId}`);
    lines.push(`- errorType: ${p.errorType}`);
    lines.push(`- recommendation: ${p.recommendation}`);
  }
  return lines.join('\n');
}
