/**
 * 由结构化输入生成 PR 描述（markdown）。纯函数、永不抛。
 *
 * 缺省字段则省略对应小节；空输入 `{}` 返回最小但合法的 markdown（仅标题占位）。
 * 本文件**不接入任何生效路径**（dead-code-safe）。
 */

import type { PrDescriptionInput } from './PrOutputTypes';

const DEFAULT_TITLE = 'Stagent delivery';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function renderBulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function renderQualitySection(
  quality: PrDescriptionInput['quality'],
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
    lines.push('', '### 验证证据', ...renderBulletList(evidence));
  }

  const notGreen = (typeof q.testsFailed === 'number' && q.testsFailed > 0) || q.smokePassed === false;
  if (notGreen) {
    lines.push('', '⚠️ 验证未全绿');
  }

  return lines;
}

export function buildPrDescription(input: PrDescriptionInput): string {
  const safeInput: PrDescriptionInput =
    input && typeof input === 'object' ? input : {};

  const sections: string[] = [];

  const title =
    typeof safeInput.title === 'string' && safeInput.title.trim().length > 0
      ? safeInput.title.trim()
      : DEFAULT_TITLE;
  sections.push(`# ${title}`);

  const taskGoal =
    typeof safeInput.taskGoal === 'string' ? safeInput.taskGoal.trim() : '';
  if (taskGoal.length > 0) {
    sections.push(['## 目标', taskGoal].join('\n'));
  }

  const acceptance = toStringArray(safeInput.acceptance);
  if (acceptance.length > 0) {
    sections.push(['## 完成标准', ...renderBulletList(acceptance)].join('\n'));
  }

  const deliverables = toStringArray(safeInput.deliverables);
  if (deliverables.length > 0) {
    sections.push(['## 交付物', ...renderBulletList(deliverables)].join('\n'));
  }

  const changedFiles = toStringArray(safeInput.changedFiles);
  if (changedFiles.length > 0) {
    sections.push(['## 变更文件', ...renderBulletList(changedFiles)].join('\n'));
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
