import type { Stage, WorkflowDefinition } from './WorkflowDefinition';
import { verifyDecisionRecord, type DecisionViolation } from './DecisionRecordVerify';
import { isHollowImplOutput } from './ImplOutputGuard';

/** 写入 StageRuntime.outputs，供 M15.2 ConfidenceScorer 等读取 */
export const QUALITY_SCORE_OUTPUT_KEY = '_qualityScore';

export type QualityRecommendation = 'approve' | 'review' | 'retry';

export interface QualityIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface QualityScore {
  overall: number;
  dimensions: {
    completeness: number;
    codeValidity: number;
    specCompliance: number;
    decisionQuality: number;
  };
  issues: QualityIssue[];
  recommendation: QualityRecommendation;
}

const TRUNCATION_MARKERS = [/\[内容已截断/, /\[\s*truncated\s*\]/i];

const NON_CODE_ARTIFACT_EXT = /\.(txt|env|ini|cfg|conf|toml|md|csv|tsv|yaml|yml|json|lock|properties)$/i;

/**
 * 该阶段产出的是「非代码」文本/配置/数据落盘文件（requirements.txt、.env、config.yaml、*.json 等）。
 * 这类产物天然简短且**不需要** ``` 代码块，按代码标准（最小长度 / 必含代码块）扣分会造成误判
 * （如 requirements.txt 被判 critical 触发不必要的暂停）。
 */
export function isNonCodeArtifactStage(stage: Stage): boolean {
  const tc = stage.toolConfig;
  if (tc.type !== 'llm-text') {
    return false;
  }
  const out = tc.writeOutputToFile?.trim().toLowerCase();
  if (!out) {
    return false;
  }
  const base = out.split('/').pop() ?? out;
  if (base === 'requirements.txt' || base === '.env' || base.startsWith('.env.')) {
    return true;
  }
  return NON_CODE_ARTIFACT_EXT.test(base);
}

function primaryDeclaredOutputKey(stage: Stage): string | undefined {
  return stage.outputs[0]?.key;
}

function scoreCompleteness(text: string, stage: Stage): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  const trimmed = text.trim();

  if (!trimmed) {
    issues.push({
      code: 'empty-output',
      severity: 'error',
      message: '阶段输出为空',
    });
    return { score: 0, issues };
  }

  let score = 1;
  if (TRUNCATION_MARKERS.some((re) => re.test(text))) {
    score = 0.35;
    issues.push({
      code: 'truncated-output',
      severity: 'warning',
      message: '输出含截断标记，可能不完整',
    });
  }

  const minChars = stage.isDecisionStage
    ? 120
    : isNonCodeArtifactStage(stage)
      ? 8
      : /^stage_impl_/.test(stage.id)
        ? 40
        : 20;
  if (trimmed.length < minChars) {
    score = Math.min(score, 0.45);
    issues.push({
      code: 'short-output',
      severity: 'warning',
      message: `输出过短（${trimmed.length} 字符，期望至少约 ${minChars}）`,
    });
  }

  return { score, issues };
}

function scoreCodeValidity(text: string, stage: Stage): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  if (stage.isDecisionStage) {
    return { score: 1, issues };
  }

  if (/^stage_impl_/.test(stage.id)) {
    if (!text.trim()) {
      issues.push({
        code: 'empty-impl-output',
        severity: 'error',
        message: '实现阶段输出为空',
      });
      return { score: 0, issues };
    }
    if (isHollowImplOutput(text)) {
      issues.push({
        code: 'hollow-impl-output',
        severity: 'error',
        message: '实现阶段输出为确认性空话，缺少可执行代码',
      });
      return { score: 0.1, issues };
    }
    if (isNonCodeArtifactStage(stage)) {
      return { score: 0.95, issues };
    }
    if (!/```/.test(text) && text.trim().length > 0) {
      issues.push({
        code: 'missing-code-fence',
        severity: 'warning',
        message: '实现阶段输出未包含代码块（```）',
      });
      return { score: 0.55, issues };
    }
    const fences = text.match(/```[\s\S]*?```/g) ?? [];
    if (fences.length > 0) {
      const unbalanced = fences.some((block) => {
        const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
        const open = (inner.match(/\{/g) ?? []).length;
        const close = (inner.match(/\}/g) ?? []).length;
        return open > 0 && close > 0 && Math.abs(open - close) > 2;
      });
      if (unbalanced) {
        issues.push({
          code: 'unbalanced-braces',
          severity: 'info',
          message: '代码块内花括号可能不平衡（启发式）',
        });
        return { score: 0.7, issues };
      }
    }
    return { score: 0.95, issues };
  }

  return { score: 1, issues };
}

function scoreSpecCompliance(text: string, stage: Stage): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  const primary = primaryDeclaredOutputKey(stage);

  if (!primary) {
    issues.push({
      code: 'no-declared-output',
      severity: 'warning',
      message: '阶段未声明 outputs[0].key',
    });
    return { score: 0.5, issues };
  }

  if (stage.isDecisionStage) {
    const hasDecisionKey = stage.outputs.some((o) => o.key === 'decisionRecord');
    if (!hasDecisionKey) {
      issues.push({
        code: 'missing-decision-record-key',
        severity: 'error',
        message: '决策阶段 outputs 须包含 decisionRecord',
      });
      return { score: 0.2, issues };
    }
    if (primary !== 'decisionRecord') {
      issues.push({
        code: 'non-primary-decision-key',
        severity: 'info',
        message: `主输出键为 ${primary}，期望 decisionRecord`,
      });
    }
  }

  if (stage.tool !== 'llm-text') {
    return { score: 1, issues };
  }

  const tc = stage.toolConfig;
  const systemPrompt = tc.type === 'llm-text' ? (tc.systemPrompt ?? '') : '';
  if (tc.type === 'llm-text' && systemPrompt.trim().length < 20) {
    issues.push({
      code: 'thin-system-prompt',
      severity: 'info',
      message: 'systemPrompt 过短，可能难以约束输出形态',
    });
    return { score: 0.85, issues };
  }

  if (!text.trim()) {
    return { score: 0, issues };
  }

  return { score: 1, issues };
}

function decisionViolationsToIssues(violations: DecisionViolation[]): QualityIssue[] {
  return violations.map((v) => ({
    code: `decision-${v.code}`,
    severity: 'error' as const,
    message: `${v.invariantId}: ${v.message}`,
  }));
}

function scoreDecisionDimension(text: string, stage: Stage): { score: number; issues: QualityIssue[] } {
  if (!stage.isDecisionStage) {
    return { score: 1, issues: [] };
  }

  const verify = verifyDecisionRecord(text);
  if (verify.ok) {
    return { score: 1, issues: [] };
  }

  const issues = decisionViolationsToIssues(verify.violations);
  const penalty = Math.min(0.85, verify.violations.length * 0.22);
  return { score: Math.max(0.05, 1 - penalty), issues };
}

function weightedOverall(
  dimensions: QualityScore['dimensions'],
  stage: Stage,
): number {
  if (stage.isDecisionStage) {
    return (
      dimensions.completeness * 0.15 +
      dimensions.codeValidity * 0.05 +
      dimensions.specCompliance * 0.1 +
      dimensions.decisionQuality * 0.7
    );
  }
  if (/^stage_impl_/.test(stage.id)) {
    return (
      dimensions.completeness * 0.25 +
      dimensions.codeValidity * 0.4 +
      dimensions.specCompliance * 0.2 +
      dimensions.decisionQuality * 0.15
    );
  }
  return (
    dimensions.completeness * 0.4 +
    dimensions.codeValidity * 0.2 +
    dimensions.specCompliance * 0.3 +
    dimensions.decisionQuality * 0.1
  );
}

function deriveRecommendation(overall: number, issues: QualityIssue[]): QualityRecommendation {
  const hasError = issues.some((i) => i.severity === 'error');
  if (hasError && overall < 0.5) {
    return 'retry';
  }
  if (hasError || overall < 0.55) {
    return 'review';
  }
  if (overall >= 0.75) {
    return 'approve';
  }
  return 'review';
}

/**
 * 针对 llm-text 阶段输出的静态质量评分（纯规则，无 LLM）。
 * `definition` 预留供后续按 taskType / globalConfig 加权（M15+）。
 */
export function scoreStatically(
  stage: Stage,
  output: string,
  _definition: WorkflowDefinition,
): QualityScore {
  const text = typeof output === 'string' ? output : String(output ?? '');

  const c = scoreCompleteness(text, stage);
  const v = scoreCodeValidity(text, stage);
  const s = scoreSpecCompliance(text, stage);
  const d = scoreDecisionDimension(text, stage);

  const dimensions = {
    completeness: c.score,
    codeValidity: v.score,
    specCompliance: s.score,
    decisionQuality: d.score,
  };

  const issues = [...c.issues, ...v.issues, ...s.issues, ...d.issues];
  const overall = Math.round(weightedOverall(dimensions, stage) * 1000) / 1000;
  const recommendation = deriveRecommendation(overall, issues);

  return {
    overall,
    dimensions,
    issues,
    recommendation,
  };
}
