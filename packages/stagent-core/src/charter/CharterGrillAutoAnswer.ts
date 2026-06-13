import type { Question } from '../WorkflowDefinition';
import { matchCharterToDecision } from './CharterAnswerRouter';
import type {
  CharterAutoAnswerMode,
  CharterDocument,
  CharterMatchResult,
  DecisionProvenance,
} from './CharterTypes';
export interface CharterGrillAnswerAttempt {
  filled: boolean;
  answer?: string;
  match: CharterMatchResult;
}

const PROVENANCE_PRIORITY: Record<DecisionProvenance, number> = {
  human: 1,
  charter_direct: 2,
  charter_inferred: 3,
  escalated: 4,
};

function questionText(question: Pick<Question, 'text' | 'hint'>): string {
  return `${question.text ?? ''} ${question.hint ?? ''}`.trim();
}

/** 是否可用 Charter 结果自动填入 grill 答案（不替代 escalated 升级项）。 */
export function canAutoFillFromCharterMatch(
  match: CharterMatchResult,
  mode: CharterAutoAnswerMode,
): boolean {
  if (mode === 'off') {
    return false;
  }
  if (match.kind === 'uncovered' || match.kind === 'conflict') {
    return false;
  }
  if (!match.proposal?.trim()) {
    return false;
  }
  return true;
}

export function formatGrillAnswerFromCharter(match: CharterMatchResult): string {
  const basis = match.ruleRefs.length ? ` · ${match.ruleRefs.map((n) => `R#${n}`).join(' ')}` : '';
  const reasoning = match.reasoning ? `（${match.reasoning}）` : '';
  return `${match.proposal}${reasoning}\n\n[provenance: ${match.provenance}${basis}]`;
}

export function aggregateGrillProvenance(
  perQuestion: Record<string, DecisionProvenance> | undefined,
): DecisionProvenance | undefined {
  if (!perQuestion || Object.keys(perQuestion).length === 0) {
    return undefined;
  }
  let top: DecisionProvenance = 'human';
  for (const p of Object.values(perQuestion)) {
    if (PROVENANCE_PRIORITY[p] > PROVENANCE_PRIORITY[top]) {
      top = p;
    }
  }
  return top;
}

export function recordCharterQuestionProvenance(
  runtime: { charterQuestionProvenance?: Record<string, DecisionProvenance> },
  questionId: string,
  provenance: DecisionProvenance,
): void {
  runtime.charterQuestionProvenance = {
    ...(runtime.charterQuestionProvenance ?? {}),
    [questionId]: provenance,
  };
}

export function syncDecisionProvenanceFromGrill(runtime: {
  charterQuestionProvenance?: Record<string, DecisionProvenance>;
  decisionProvenance?: DecisionProvenance;
}): void {
  const agg = aggregateGrillProvenance(runtime.charterQuestionProvenance);
  if (agg) {
    runtime.decisionProvenance = agg;
  }
}

/** 仅 auto-with-escalation 静默写入 runtime；suggest 须 UI 确认。 */
export function shouldSilentPrefillFromCharter(mode: CharterAutoAnswerMode): boolean {
  return mode === 'auto-with-escalation';
}

export function tryCharterAnswerForQuestionWithDoc(
  question: Pick<Question, 'id' | 'text' | 'hint'>,
  doc: CharterDocument | null,
  mode: CharterAutoAnswerMode,
  confidence = 0.85,
  confidenceThreshold = 0.4,
): CharterGrillAnswerAttempt | null {
  if (!doc || mode === 'off') {
    return null;
  }
  const match = matchCharterToDecision(questionText(question), doc, confidence, confidenceThreshold);
  if (!canAutoFillFromCharterMatch(match, mode)) {
    return { filled: false, match };
  }
  const filled = shouldSilentPrefillFromCharter(mode);
  return {
    filled,
    answer: filled ? formatGrillAnswerFromCharter(match) : undefined,
    match,
  };
}

