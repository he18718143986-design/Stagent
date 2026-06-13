import type { Stage, StageRuntime } from './WorkflowDefinition';
import { isNonCodeArtifactStage, type QualityScore } from './OutputQualityScorer';

/** 写入 StageRuntime.outputs，供 M15.6 UI / M16.2 AdaptiveHITLPolicy 读取 */
export const CONFIDENCE_OUTPUT_KEY = '_confidence';

export type ConfidenceStageType = 'decision' | 'impl' | 'test' | 'other';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'critical';

export interface ConfidenceSignals {
  qualityScore?: QualityScore;
  retryCount: number;
  stageType: ConfidenceStageType;
  outputLength: number;
  hasCodeBlock: boolean;
  matchesExpectedOutputKey: boolean;
  /** 产出非代码文本/配置文件（requirements.txt、.env、*.yaml 等）；这类产物豁免「过短 / 缺代码块」扣分 */
  isNonCodeArtifact?: boolean;
  /** M17 FailurePatternAnalyzer 注入；M15.2 仅作降权 stub */
  priorFailurePattern?: string;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  reasons: string[];
}

const RETRY_PENALTY = 0.12;
const PRIOR_FAILURE_PENALTY = 0.15;
const OUTPUT_KEY_MISMATCH_PENALTY = 0.2;

export function classifyStageType(stage: Stage): ConfidenceStageType {
  if (stage.isDecisionStage) {
    return 'decision';
  }
  if (/^stage_impl_/.test(stage.id)) {
    return 'impl';
  }
  if (/^stage_test_(run|write)_/.test(stage.id)) {
    return 'test';
  }
  return 'other';
}

export function buildConfidenceSignals(
  stage: Stage,
  runtime: StageRuntime,
  actualOutputKey: string,
  outputText: string,
  qualityScore?: QualityScore,
  opts?: { priorFailurePattern?: string },
): ConfidenceSignals {
  const expectedPrimary = stage.outputs[0]?.key;
  const text = typeof outputText === 'string' ? outputText : String(outputText ?? '');
  return {
    qualityScore,
    retryCount: runtime.retryCount ?? 0,
    stageType: classifyStageType(stage),
    outputLength: text.trim().length,
    hasCodeBlock: /```/.test(text),
    matchesExpectedOutputKey: expectedPrimary === undefined || actualOutputKey === expectedPrimary,
    isNonCodeArtifact: isNonCodeArtifactStage(stage),
    priorFailurePattern: opts?.priorFailurePattern,
  };
}

function minLengthForStageType(stageType: ConfidenceStageType): number {
  switch (stageType) {
    case 'decision':
      return 120;
    case 'impl':
      return 40;
    case 'test':
      return 20;
    default:
      return 15;
  }
}

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.55) {
    return 'medium';
  }
  if (score >= 0.35) {
    return 'low';
  }
  return 'critical';
}

/**
 * 综合质量分、重试次数、输出形态等信号，计算 0–1 置信度（越低越需人工介入）。
 * 纯函数；不读取 vscode / 磁盘。
 */
export function computeConfidence(signals: ConfidenceSignals): ConfidenceResult {
  const reasons: string[] = [];
  let score = signals.qualityScore?.overall ?? 0.65;

  if (signals.qualityScore) {
    if (signals.qualityScore.recommendation === 'retry') {
      score = Math.min(score, 0.35);
      reasons.push('质量评分建议重试');
    } else if (signals.qualityScore.recommendation === 'review') {
      score = Math.min(score, 0.58);
      reasons.push('质量评分建议人工复核');
    }
    const errorIssues = signals.qualityScore.issues.filter((i) => i.severity === 'error');
    if (errorIssues.length > 0) {
      score -= Math.min(0.25, errorIssues.length * 0.08);
      reasons.push(`质量检查发现 ${errorIssues.length} 项错误`);
    }
  } else {
    reasons.push('无质量评分，使用中性先验 0.65');
  }

  if (signals.retryCount > 0) {
    const penalty = Math.min(0.45, signals.retryCount * RETRY_PENALTY);
    score -= penalty;
    reasons.push(`已手动重试 ${signals.retryCount} 次`);
  }

  if (!signals.matchesExpectedOutputKey) {
    score -= OUTPUT_KEY_MISMATCH_PENALTY;
    reasons.push('主输出键与 stage.outputs[0] 不一致');
  }

  const minLen = signals.isNonCodeArtifact ? 8 : minLengthForStageType(signals.stageType);
  if (signals.outputLength < minLen) {
    score -= 0.18;
    reasons.push(`输出过短（${signals.outputLength} 字符，${signals.stageType} 期望 ≥ ${minLen}）`);
  }

  if (
    signals.stageType === 'impl' &&
    !signals.isNonCodeArtifact &&
    !signals.hasCodeBlock &&
    signals.outputLength > 0
  ) {
    score -= 0.12;
    reasons.push('实现阶段输出未含代码块');
  }

  if (signals.priorFailurePattern?.trim()) {
    score -= PRIOR_FAILURE_PENALTY;
    reasons.push(`历史失败模式：${signals.priorFailurePattern.trim()}`);
  }

  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  const level = scoreToLevel(score);

  if (reasons.length === 0) {
    reasons.push('信号良好，置信度较高');
  }

  return { score, level, reasons };
}
