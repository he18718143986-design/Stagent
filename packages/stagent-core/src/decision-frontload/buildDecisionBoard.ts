import type { Stage } from '../WorkflowDefinition';
import { matchCharterToDecision } from '../charter/CharterAnswerRouter';
import type { CharterDocument } from '../charter/CharterTypes';
import { plainDecisionBoardSummary } from '../friendly/toPlainLanguage';
import type { DecisionBoardItem, DecisionBoardPayload } from './DecisionFrontloadTypes';

function decisionQuestionForStage(stage: Stage): string {
  const parts: string[] = [stage.title];
  if (stage.description) {
    parts.push(stage.description);
  }
  if (stage.questionBefore?.length) {
    for (const q of stage.questionBefore) {
      if (q.text) {
        parts.push(q.text);
      }
    }
  }
  if (stage.aiTip && String(stage.aiTip).trim()) {
    parts.push(String(stage.aiTip).trim());
  }
  return parts.join('\n');
}

function stripPhasePrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, '').trim() || title;
}

function buildItem(stage: Stage, charter: CharterDocument | null): DecisionBoardItem {
  const question = decisionQuestionForStage(stage);
  const match = charter
    ? matchCharterToDecision(question, charter, 1)
    : matchCharterToDecision(question, { sourcePath: '', prefers: [], avoids: [], acceptable: [], constraints: [], escalationRules: [] }, 1);

  const stageTitle = stripPhasePrefix(stage.title);
  return {
    stageId: stage.id,
    stageTitle,
    kind: match.kind,
    provenance: match.provenance,
    matchScore: match.matchScore,
    conflictScore: match.conflictScore,
    ruleRefs: match.ruleRefs,
    proposal: match.proposal,
    reasoning: match.reasoning,
    requiresUser: match.kind !== 'auto',
    plainSummary: plainDecisionBoardSummary({
      stageTitle,
      kind: match.kind,
      provenance: match.provenance,
      proposal: match.proposal,
    }),
  };
}

export function buildDecisionBoardPayload(
  decisionStages: Stage[],
  charter: CharterDocument | null,
): DecisionBoardPayload {
  const items = decisionStages.map((s) => buildItem(s, charter));
  const auto = items.filter((i) => !i.requiresUser).length;
  return {
    items,
    summary: {
      total: items.length,
      auto,
      needsReview: items.length - auto,
    },
  };
}
