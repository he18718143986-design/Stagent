import { COMMITMENT_SNAPSHOT_OUTPUT_KEY } from '../commitment';
import type { CommitmentSnapshot } from '../commitment';
import { GATE_ID_IMPL_WRITE_SCOPE } from '../QualityGateIds';
import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import { normalizeArtifactRelativePath } from '../WorkflowArtifactRegistry';
import { writeOutputToFileOf } from '../workflow/StageToolConfigAccess';
import { isImplStageId } from '../workflow/StageIdPatterns';
import { readContractBoundExecutionEnabled } from '../settings/readers/contract';
import type { QualityGate } from '../QualityGate';
import { block, isImplStage } from './gateHelpers';

function findDecisionStageForImpl(implStageId: string, stages: { id: string; isDecisionStage?: boolean }[]): string | undefined {
  const semantic = implStageId.replace(/^stage_impl_/, '');
  const decideId = `stage_decide_${semantic}`;
  if (stages.some((s) => s.id === decideId)) {
    return decideId;
  }
  return stages.find((s) => s.isDecisionStage)?.id;
}

export const IMPL_WRITE_SCOPE_GATE: QualityGate = {
  id: GATE_ID_IMPL_WRITE_SCOPE,
  label: 'impl 窄写入（CommitmentSnapshot）',
  phase: 'pre-stage',
  priority: 25,
  when: 'before-impl',
  enabled: (ctx) => readContractBoundExecutionEnabled() && isImplStage(ctx.stage) && !!ctx.instance,
  evaluate(ctx) {
    const stage = ctx.stage!;
    const instance = ctx.instance!;
    if (!isImplStageId(stage.id)) {
      return null;
    }
    const writeTarget = writeOutputToFileOf(stage)?.trim();
    if (!writeTarget) {
      return null;
    }
    const decideId = findDecisionStageForImpl(stage.id, instance.definition.stages);
    if (!decideId) {
      return null;
    }
    const decideRt = instance.stageRuntimes.find((rt) => rt.stageId === decideId);
    const raw = decideRt?.outputs[COMMITMENT_SNAPSHOT_OUTPUT_KEY];
    const registry = collectWorkflowArtifacts(instance.definition);
    const normTarget = normalizeArtifactRelativePath(writeTarget);
    const inRegistry = registry.paths.some((p) => normalizeArtifactRelativePath(p) === normTarget);

    if (!raw || typeof raw !== 'object') {
      if (inRegistry) {
        return null;
      }
      return block(GATE_ID_IMPL_WRITE_SCOPE, [
        `impl 写入 ${writeTarget} 未在 CommitmentSnapshot 或 workflow artifact 中声明`,
      ]);
    }

    const snapshot = raw as CommitmentSnapshot;
    const declared = snapshot.commitments.some(
      (c) =>
        c.kind === 'file_path' &&
        normalizeArtifactRelativePath(c.subject) === normTarget,
    );
    if (declared || inRegistry) {
      return null;
    }
    return block(GATE_ID_IMPL_WRITE_SCOPE, [
      `impl 写入 ${writeTarget} 未在 CommitmentSnapshot file_path 承诺中声明`,
    ]);
  },
};
