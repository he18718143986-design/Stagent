import type { Question } from './WorkflowDefinition';

type LooseQuestion = Partial<Question> & {
  question?: unknown;
  prompt?: unknown;
  title?: unknown;
};

function pickText(raw: LooseQuestion, fallback: string): string {
  const text =
    (typeof raw.text === 'string' && raw.text.trim()) ||
    (typeof raw.question === 'string' && raw.question.trim()) ||
    (typeof raw.prompt === 'string' && raw.prompt.trim()) ||
    (typeof raw.title === 'string' && raw.title.trim()) ||
    (typeof raw.hint === 'string' && raw.hint.trim()) ||
    '';
  return text || fallback;
}

export function normalizeQuestions(
  questions: unknown,
  stageId: string,
  mode: 'before' | 'after',
): Question[] | undefined {
  if (!Array.isArray(questions) || questions.length === 0) {
    return undefined;
  }

  const normalized: Question[] = [];
  questions.forEach((q, idx) => {
    const raw = (q ?? {}) as LooseQuestion;
    const id =
      (typeof raw.id === 'string' && raw.id.trim()) || `${mode}_q_${idx + 1}`;
    const fallbackText = `请补充问题 ${idx + 1}`;
    const text = pickText(raw, fallbackText);
    const hint = typeof raw.hint === 'string' ? raw.hint : undefined;
    const required = raw.required !== false;
    normalized.push({ id, text, hint, required });
  });

  return normalized;
}
