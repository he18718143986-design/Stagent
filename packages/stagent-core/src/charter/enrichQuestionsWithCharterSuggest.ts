import type { Question, Stage } from '../WorkflowDefinition';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import {
  readCharterAutoAnswerMode,
  readCharterEnabled,
  readCharterRelativePath,
} from '../settings/readers/charter';
import type { CharterMatchResult } from './CharterTypes';
import { tryCharterAnswerForQuestionWithDoc } from './CharterGrillAutoAnswer';
import { loadCharterFromWorkspaceSync } from './CharterLoader';

/** 是否可向 UI 展示 Charter 推荐（含 suggest 模式）。 */
export function canSuggestFromCharterMatch(match: CharterMatchResult): boolean {
  if (match.provenance === 'escalated') {
    return false;
  }
  if (match.kind === 'uncovered' || match.kind === 'conflict') {
    return false;
  }
  return !!match.proposal?.trim();
}

export function formatSuggestedAnswerFromMatch(match: CharterMatchResult): string | undefined {
  const proposal = match.proposal?.trim();
  if (!proposal) {
    return undefined;
  }
  const reasoning = match.reasoning ? `（${match.reasoning}）` : '';
  return `${proposal}${reasoning}`;
}

export function enrichQuestionsWithCharterSuggest(
  questions: Question[],
  workspaceRoot: string | undefined,
): Question[] {
  const cfg = getStagentConfiguration();
  if (!readCharterEnabled(cfg) || !workspaceRoot) {
    return questions;
  }
  const mode = readCharterAutoAnswerMode(cfg);
  if (mode === 'off') {
    return questions;
  }
  const doc = loadCharterFromWorkspaceSync(workspaceRoot, readCharterRelativePath(cfg));
  return questions.map((q) => {
    const attempt = tryCharterAnswerForQuestionWithDoc(q, doc, mode);
    if (!attempt || !canSuggestFromCharterMatch(attempt.match)) {
      return q;
    }
    const suggestedAnswer = formatSuggestedAnswerFromMatch(attempt.match);
    if (!suggestedAnswer) {
      return q;
    }
    return {
      ...q,
      suggestedAnswer,
      provenance: attempt.match.provenance,
      ruleRefs: attempt.match.ruleRefs,
    };
  });
}

export function buildStageQuestionsBeforePayload(
  stage: Pick<Stage, 'id'>,
  questions: Question[],
  workspaceRoot: string | undefined,
): { stageId: string; questions: Question[] } {
  return {
    stageId: stage.id,
    questions: enrichQuestionsWithCharterSuggest(questions, workspaceRoot),
  };
}
