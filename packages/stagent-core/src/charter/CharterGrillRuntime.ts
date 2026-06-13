import type { Question } from '../WorkflowDefinition';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import {
  readCharterAutoAnswerMode,
  readCharterEnabled,
  readCharterRelativePath,
} from '../settings/readers/charter';
import type { DecisionProvenance } from './CharterTypes';
import { matchCharterToDecision } from './CharterAnswerRouter';
import { loadCharterFromWorkspaceSync } from './CharterLoader';
import {
  canSuggestFromCharterMatch,
} from './enrichQuestionsWithCharterSuggest';
import {
  recordCharterQuestionProvenance,
  shouldSilentPrefillFromCharter,
  syncDecisionProvenanceFromGrill,
  tryCharterAnswerForQuestionWithDoc,
  type CharterGrillAnswerAttempt,
} from './CharterGrillAutoAnswer';

function questionText(question: Pick<Question, 'text' | 'hint'>): string {
  return `${question.text ?? ''} ${question.hint ?? ''}`.trim();
}

export function tryCharterAnswerForQuestion(
  question: Pick<Question, 'id' | 'text' | 'hint'>,
  workspaceRoot: string | undefined,
  confidence = 0.85,
  confidenceThreshold = 0.4,
): CharterGrillAnswerAttempt | null {
  const cfg = getStagentConfiguration();
  if (!readCharterEnabled(cfg) || !workspaceRoot) {
    return null;
  }
  const mode = readCharterAutoAnswerMode(cfg);
  const doc = loadCharterFromWorkspaceSync(workspaceRoot, readCharterRelativePath(cfg));
  return tryCharterAnswerForQuestionWithDoc(question, doc, mode, confidence, confidenceThreshold);
}

/** suggest 模式：存在 Charter 推荐且未答的题须进入 UI 确认。 */
export function hasCharterSuggestionsPendingConfirm(
  questions: Question[] | undefined,
  answers: Record<string, string> | undefined,
  workspaceRoot: string | undefined,
): boolean {
  const cfg = getStagentConfiguration();
  if (readCharterAutoAnswerMode(cfg) !== 'suggest') {
    return false;
  }
  if (!readCharterEnabled(cfg) || !workspaceRoot) {
    return false;
  }
  const doc = loadCharterFromWorkspaceSync(workspaceRoot, readCharterRelativePath(cfg));
  if (!doc) {
    return false;
  }
  const merged = { ...(answers ?? {}) };
  for (const q of questions ?? []) {
    if (String(merged[q.id] ?? '').trim()) {
      continue;
    }
    const match = matchCharterToDecision(questionText(q), doc, 0.85, 0.4);
    if (canSuggestFromCharterMatch(match)) {
      return true;
    }
  }
  return false;
}

/** 批量模式：auto-with-escalation 静默预填；suggest 不写 runtime。 */
export function prefillQuestionBeforeFromCharter(input: {
  questions: Question[] | undefined;
  answers: Record<string, string> | undefined;
  runtime: {
    questionBeforeAnswers?: Record<string, string>;
    charterQuestionProvenance?: Record<string, DecisionProvenance>;
  };
  workspaceRoot: string | undefined;
}): boolean {
  const cfg = getStagentConfiguration();
  const mode = readCharterAutoAnswerMode(cfg);
  if (!shouldSilentPrefillFromCharter(mode)) {
    return false;
  }
  const list = input.questions ?? [];
  let changed = false;
  const merged = { ...(input.answers ?? {}), ...(input.runtime.questionBeforeAnswers ?? {}) };
  for (const q of list) {
    if (String(merged[q.id] ?? '').trim()) {
      continue;
    }
    const attempt = tryCharterAnswerForQuestion(q, input.workspaceRoot);
    if (!attempt?.filled || !attempt.answer) {
      continue;
    }
    input.runtime.questionBeforeAnswers = {
      ...(input.runtime.questionBeforeAnswers ?? {}),
      [q.id]: attempt.answer,
    };
    recordCharterQuestionProvenance(input.runtime, q.id, attempt.match.provenance);
    changed = true;
  }
  if (changed) {
    syncDecisionProvenanceFromGrill(input.runtime);
  }
  return changed;
}
