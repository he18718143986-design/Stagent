import type { ScopeFinding, TaskBrief } from './TaskBriefTypes';

/**
 * Best-effort scope-creep heuristic. Compares `candidateText` against the brief's
 * declared non-goals and boundaries using whole-term, case-insensitive substring
 * matching (robust and low-false-positive for both Chinese and English phrases).
 *
 * This is a *warn-only* helper, not a hard gate. It is a pure function and never
 * throws: a non-string or empty `candidateText` yields `[]`.
 */
export function checkScopeCreep(brief: TaskBrief, candidateText: string): ScopeFinding[] {
  if (typeof candidateText !== 'string' || candidateText.length === 0) {
    return [];
  }

  const haystack = candidateText.toLowerCase();
  const findings: ScopeFinding[] = [];

  const nonGoals = Array.isArray(brief?.nonGoals) ? brief.nonGoals : [];
  for (const term of nonGoals) {
    if (typeof term !== 'string') {
      continue;
    }
    const needle = term.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) {
      findings.push({
        kind: 'non-goal-touched',
        term,
        detail: `候选内容疑似触碰非目标「${term}」`,
      });
    }
  }

  const boundaries = Array.isArray(brief?.boundaries) ? brief.boundaries : [];
  for (const term of boundaries) {
    if (typeof term !== 'string') {
      continue;
    }
    const needle = term.trim().toLowerCase();
    if (needle.length > 0 && haystack.includes(needle)) {
      findings.push({
        kind: 'boundary-violated',
        term,
        detail: `候选内容疑似违反边界「${term}」`,
      });
    }
  }

  return findings;
}
