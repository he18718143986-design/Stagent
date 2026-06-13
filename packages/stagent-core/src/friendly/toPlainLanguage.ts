import {
  humanizeJargon,
  PLAIN_DECISION_KIND_LABELS,
  PLAIN_PROVENANCE_LABELS,
  PLAIN_TASK_TYPE_LABELS,
  PLAIN_TOOL_LABELS,
} from './TranslationGlossary';

export function plainTaskTypeLabel(taskType: string | undefined): string {
  if (!taskType) {
    return '未指定';
  }
  return PLAIN_TASK_TYPE_LABELS[taskType] ?? taskType;
}

export function plainProvenanceLabel(provenance: string): string {
  return PLAIN_PROVENANCE_LABELS[provenance] ?? humanizeJargon(provenance);
}

export function plainDecisionKindLabel(kind: string): string {
  return PLAIN_DECISION_KIND_LABELS[kind] ?? kind;
}

export function plainToolLabel(tool: string): string {
  return PLAIN_TOOL_LABELS[tool] ?? tool;
}

/** 决策板条目一句话摘要（B-R3）。 */
export function plainDecisionBoardSummary(params: {
  stageTitle: string;
  kind: string;
  provenance: string;
  proposal?: string;
}): string {
  const title = humanizeJargon(params.stageTitle.trim());
  const kind = plainDecisionKindLabel(params.kind);
  const prov = plainProvenanceLabel(params.provenance);
  const preview = params.proposal?.trim().slice(0, 80);
  if (preview) {
    return `${title}：${kind}（${prov}）— ${humanizeJargon(preview)}`;
  }
  return `${title}：${kind}（${prov}）`;
}

interface CharterFeedbackCandidate {
  provenance: string;
  reason: string;
  decisionRecord: string;
}

/** Charter 反馈候选 QuickPick 描述（B-R3）。 */
export function plainCharterFeedbackDescription(candidate: CharterFeedbackCandidate): string {
  const prov = plainProvenanceLabel(candidate.provenance);
  const reason = humanizeJargon(candidate.reason);
  const preview = humanizeJargon(candidate.decisionRecord.slice(0, 96));
  return `${prov} · ${reason} — ${preview}`;
}
