import type { TaskBrief } from './TaskBriefTypes';

/**
 * Renders a TaskBrief as Markdown (目标 / 非目标 / 边界 / 完成标准) for future
 * persistence/display. Pure formatting helper; not wired into any live path.
 */
export function formatTaskBriefMarkdown(brief: TaskBrief): string {
  const lines: string[] = [];

  lines.push('## 目标');
  lines.push(brief.goal.trim().length > 0 ? brief.goal.trim() : '_（未填写）_');

  lines.push('');
  lines.push('## 非目标');
  lines.push(...renderList(brief.nonGoals));

  lines.push('');
  lines.push('## 边界');
  lines.push(...renderList(brief.boundaries));

  lines.push('');
  lines.push('## 完成标准');
  lines.push(...renderList(brief.acceptance));

  return lines.join('\n');
}

function renderList(items: string[]): string[] {
  const cleaned = (Array.isArray(items) ? items : [])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (cleaned.length === 0) {
    return ['_（无）_'];
  }
  return cleaned.map((v) => `- ${v}`);
}
