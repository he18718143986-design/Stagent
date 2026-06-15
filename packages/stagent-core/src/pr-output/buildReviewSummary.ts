/**
 * 由结构化输入生成评审摘要（markdown）。纯函数、永不抛。
 *
 * findings 按 severity 分组（error → warn → info），附 quality / verification；
 * 无 findings 时输出「无评审发现」。本文件**不接入任何生效路径**（dead-code-safe）。
 */

import type { ReviewFinding, ReviewSummaryInput } from './PrOutputTypes';

const SEVERITY_ORDER: Array<ReviewFinding['severity']> = ['error', 'warn', 'info'];

const SEVERITY_LABEL: Record<ReviewFinding['severity'], string> = {
  error: 'Error',
  warn: 'Warn',
  info: 'Info',
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function isValidFinding(value: unknown): value is ReviewFinding {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<ReviewFinding>;
  if (f.severity !== 'error' && f.severity !== 'warn' && f.severity !== 'info') {
    return false;
  }
  return typeof f.message === 'string' && f.message.trim().length > 0;
}

export function summarizeFindingCounts(
  findings: ReviewFinding[],
): { error: number; warn: number; info: number } {
  const counts = { error: 0, warn: 0, info: 0 };
  if (!Array.isArray(findings)) return counts;
  for (const finding of findings) {
    if (isValidFinding(finding)) {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

function renderFinding(finding: ReviewFinding): string {
  const message = finding.message.trim();
  const location =
    typeof finding.location === 'string' && finding.location.trim().length > 0
      ? ` (${finding.location.trim()})`
      : '';
  return `- ${message}${location}`;
}

function renderQualitySection(
  quality: ReviewSummaryInput['quality'],
  verificationEvidence?: string[],
): string[] {
  const lines: string[] = [];
  const q = quality ?? {};
  const evidence = toStringArray(verificationEvidence);

  const hasTestCounts =
    typeof q.testsPassed === 'number' || typeof q.testsFailed === 'number';
  const hasSmoke = typeof q.smokePassed === 'boolean';
  const notes = toStringArray(q.notes);

  if (!hasTestCounts && !hasSmoke && notes.length === 0 && evidence.length === 0) {
    return lines;
  }

  lines.push('## 验证');

  if (hasTestCounts) {
    const passed = typeof q.testsPassed === 'number' ? q.testsPassed : 0;
    const failed = typeof q.testsFailed === 'number' ? q.testsFailed : 0;
    lines.push(`- 测试：通过 ${passed} / 失败 ${failed}`);
  }
  if (hasSmoke) {
    lines.push(`- Smoke：${q.smokePassed ? '通过' : '未通过'}`);
  }
  for (const note of notes) {
    lines.push(`- 备注：${note}`);
  }
  if (evidence.length > 0) {
    lines.push(...evidence.map((item) => `- 证据：${item}`));
  }

  return lines;
}

export function buildReviewSummary(input: ReviewSummaryInput): string {
  const safeInput: ReviewSummaryInput =
    input && typeof input === 'object' ? input : {};

  const sections: string[] = ['# 评审摘要'];

  const validFindings = Array.isArray(safeInput.findings)
    ? safeInput.findings.filter(isValidFinding)
    : [];

  if (validFindings.length === 0) {
    sections.push('无评审发现');
  } else {
    const counts = summarizeFindingCounts(validFindings);
    sections.push(
      `共 ${validFindings.length} 项发现（error ${counts.error} / warn ${counts.warn} / info ${counts.info}）`,
    );
    for (const severity of SEVERITY_ORDER) {
      const group = validFindings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      const groupLines = [
        `## ${SEVERITY_LABEL[severity]} (${group.length})`,
        ...group.map(renderFinding),
      ];
      sections.push(groupLines.join('\n'));
    }
  }

  const qualityLines = renderQualitySection(
    safeInput.quality,
    safeInput.verificationEvidence,
  );
  if (qualityLines.length > 0) {
    sections.push(qualityLines.join('\n'));
  }

  return sections.join('\n\n') + '\n';
}
