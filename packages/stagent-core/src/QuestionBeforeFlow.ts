import type { Question } from './WorkflowDefinition';

export function getMissingRequiredQuestionIds(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): string[] {
  if (!questions?.length) {
    return [];
  }
  return questions
    .filter((q) => q.required !== false)
    .filter((q) => !String(answers?.[q.id] ?? '').trim())
    .map((q) => q.id);
}

export function shouldEnterWaitingQuestions(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
): boolean {
  return getMissingRequiredQuestionIds(questions, answers).length > 0;
}

export function buildAnswerQuestionsBeforeMessage(stageId: string, answers: Record<string, string>) {
  return { type: 'answerQuestionsBefore', stageId, answers } as const;
}
