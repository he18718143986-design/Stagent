import type { TaskBrief, TaskBriefValidation } from './TaskBriefTypes';

/**
 * Completeness validation for a TaskBrief.
 *
 * `ok` depends *only* on `goal` being non-empty. Missing acceptance criteria and
 * empty non-goals/boundaries produce soft advisory issues but never flip `ok` to
 * false.
 */
export function validateTaskBrief(brief: TaskBrief): TaskBriefValidation {
  const issues: string[] = [];

  const hasGoal = typeof brief.goal === 'string' && brief.goal.trim().length > 0;
  if (!hasGoal) {
    issues.push('goal 不能为空');
  }

  if (brief.acceptance.length === 0) {
    issues.push('acceptance 为空：完成标准不可验收，建议补充');
  }
  if (brief.nonGoals.length === 0) {
    issues.push('nonGoals 为空：未声明非目标，范围蠕变防护较弱');
  }
  if (brief.boundaries.length === 0) {
    issues.push('boundaries 为空：未声明边界/约束');
  }

  return { ok: hasGoal, issues };
}
