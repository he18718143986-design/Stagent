import type { DecisionProvenance } from './CharterTypes';

export const DECISION_PROVENANCE_SECTION_HEADING = '### 决策溯源';

const PROVENANCE_SECTION_RE = /^###[\t ]+决策溯源[\t ]*$/m;

export function stripDecisionProvenanceSection(record: string): string {
  const idx = record.search(PROVENANCE_SECTION_RE);
  if (idx < 0) {
    return record.trimEnd();
  }
  return record.slice(0, idx).trimEnd();
}

export function formatDecisionProvenanceSection(opts: {
  stageId: string;
  provenance: DecisionProvenance;
  perQuestion?: Record<string, DecisionProvenance>;
}): string {
  const lines = [
    DECISION_PROVENANCE_SECTION_HEADING,
    '',
    `- stageId: ${opts.stageId}`,
    `- provenance: ${opts.provenance}`,
  ];
  const perQuestion = opts.perQuestion;
  if (perQuestion && Object.keys(perQuestion).length > 0) {
    lines.push('', '#### 逐题溯源', '');
    for (const [qid, p] of Object.entries(perQuestion)) {
      lines.push(`- ${qid}: ${p}`);
    }
  }
  return lines.join('\n');
}

export function appendDecisionProvenanceToRecord(record: string, section: string): string {
  const body = stripDecisionProvenanceSection(record);
  return `${body}\n\n${section.trim()}\n`;
}
