import type { Question } from '../WorkflowDefinition';

/** I-8: required questions (default required=true) missing non-empty answers. */
export function getMissingRequiredQuestionIds(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): string[] {
  const list = questions ?? [];
  const a = answers ?? {};
  const missingIds: string[] = [];
  for (const q of list) {
    if (q.required === false) {
      continue;
    }
    const raw = a[q.id];
    if (raw === undefined || raw === null) {
      missingIds.push(q.id);
      continue;
    }
    if (typeof raw !== 'string' || raw.trim() === '') {
      missingIds.push(q.id);
    }
  }
  return missingIds;
}

export interface RequiredAnswerCheck {
  ok: boolean;
  missingIds: string[];
}

export function validateRequiredAnswers(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): RequiredAnswerCheck {
  const missingIds = getMissingRequiredQuestionIds(questions, answers);
  return { ok: missingIds.length === 0, missingIds };
}
