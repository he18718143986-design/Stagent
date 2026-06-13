import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { DecisionArtifactsV1 } from './decisionArtifactsSchema';
import type { CommitmentSnapshot } from './types';
import { hashDecisionRecord, parseCommitmentsFromDecisionRecord } from './parseCommitments';

export const COMMITMENT_SNAPSHOT_OUTPUT_KEY = 'commitmentSnapshot';

export function extractCommitmentSnapshot(params: {
  stageId: string;
  decisionRecord: string;
  workflow?: WorkflowDefinition;
  decisionArtifacts?: DecisionArtifactsV1 | null;
}): CommitmentSnapshot {
  const parsed = parseCommitmentsFromDecisionRecord(params.decisionRecord, params.stageId);
  const warnings = [...parsed.warnings];
  let commitments = [...parsed.commitments];

  if (params.decisionArtifacts?.modules?.length) {
    for (const mod of params.decisionArtifacts.modules) {
      const name = mod.name?.trim();
      if (!name) {
        continue;
      }
      for (const sym of mod.exports ?? []) {
        const exportName = sym?.trim();
        if (!exportName) {
          continue;
        }
        const subject = `${name}.${exportName}`;
        if (commitments.some((c) => c.kind === 'export_symbol' && c.subject === subject)) {
          continue;
        }
        commitments.push({
          id: `${params.stageId}:export:${subject}`,
          kind: 'export_symbol',
          subject,
          source: 'sidecar',
          confidence: 1,
          stageId: params.stageId,
        });
      }
    }
  }

  if (params.decisionArtifacts?.files?.length) {
    commitments = commitments.filter((c) => c.kind !== 'file_path');
    for (const f of params.decisionArtifacts.files) {
      const key = f.key?.trim();
      const filePath = f.path?.trim();
      if (!key || !filePath) {
        continue;
      }
      const exists = commitments.some((c) => c.kind === 'file_path' && c.subject === filePath);
      if (!exists) {
        commitments.push({
          id: `${params.stageId}:sidecar:${key}`,
          kind: 'file_path',
          subject: filePath,
          source: 'sidecar',
          confidence: 1,
          stageId: params.stageId,
        });
      }
    }
  }

  if (params.workflow) {
    for (const stage of params.workflow.stages ?? []) {
      if (!stage.id.startsWith('stage_impl_') || stage.id === params.stageId) {
        continue;
      }
      const out = (stage.toolConfig as { writeOutputToFile?: string }).writeOutputToFile?.trim();
      if (out && stage.id.replace('stage_impl_', '') === params.stageId.replace('stage_decide_', '')) {
        const exists = commitments.some((c) => c.kind === 'file_path' && c.subject === out);
        if (!exists) {
          commitments.push({
            id: `${params.stageId}:file:${out}`,
            kind: 'file_path',
            subject: out,
            source: 'parser',
            confidence: 0.95,
            stageId: params.stageId,
          });
        }
      }
    }
  }

  return {
    stageId: params.stageId,
    recordHash: hashDecisionRecord(params.decisionRecord),
    commitments,
    extractedAt: new Date().toISOString(),
    parserWarnings: warnings,
  };
}
