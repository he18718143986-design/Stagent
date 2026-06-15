/**
 * best-of-N 候选评分（子任务 3b）：把一个已落盘候选映射为 CandidateOutcome——
 * 复用既有 **post-stage Strict-QA 门**（module-contract / export-contract / test-quality 等）
 * 与 OutputQualityScorer，**非抛**地评估（不触发同 stage 重试/失败机制、不记录 retry 状态）。
 *
 * 说明：本阶段评分用「静态 Strict-QA 门违规数 + 质量分」；test_run/smoke 是后续独立阶段，
 * 由胜者在下游照常经历（择优不替代门）。全候选静态门均不过时由调用方走既有失败路径（不伪绿）。
 */
import { runQualityGates } from '../QualityGateRunner';
import { scoreStatically } from '../OutputQualityScorer';
import { isImplStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';
import { isRuntimeReplanTestFixStageId } from '../runtime-replan/constants';
import { isFixIfFailedStageId } from '../runtime-replan/FixExhaustedRouter';
import type { StageStepContext } from '../stage-runners/StageStepContext';
import type { CandidateOutcome } from './BestOfNTypes';

/** 该阶段是否会跑 post-stage Strict-QA 门（与 scoreLlmTextConfidenceAndGates 判据一致）。 */
function stageRunsPostStageGates(stageId: string): boolean {
  return (
    isTestWriteStageId(stageId) ||
    isRuntimeReplanTestFixStageId(stageId) ||
    isImplStageId(stageId) ||
    isFixIfFailedStageId(stageId)
  );
}

export async function scoreCandidateStrictQa(
  ctx: StageStepContext,
  candidateId: string,
  instanceKey: string,
): Promise<CandidateOutcome> {
  const { params, stage, runtime, instance } = ctx;
  const outKey = params.primaryOutputKey(stage);
  const text = String(runtime.outputs[outKey] ?? '');

  let qualityScore: number | undefined;
  try {
    qualityScore = scoreStatically(stage, text, instance.definition).overall;
  } catch {
    qualityScore = undefined;
  }

  const host = params.qualityGateExecutionHost;
  let gateViolations = 0;
  let warnings = 0;
  const notes: string[] = [];
  if (host && stageRunsPostStageGates(stage.id)) {
    try {
      const summary = await runQualityGates(
        'post-stage',
        {
          phase: 'post-stage',
          workflow: instance.definition,
          stage,
          stageIndex: ctx.stageIndex,
          stageRuntime: runtime,
          instance,
          instanceKey,
          taskWorkspaceAbs: params.getWorkspaceRoot?.(),
          executionHost: host,
        },
        { stopOnBlock: true, severities: ['block', 'warn'] },
      );
      gateViolations = summary.blocks.length;
      warnings = summary.warnings.length;
      const firstBlock = summary.blocks[0];
      if (firstBlock?.messages?.length) {
        notes.push(firstBlock.messages[0]!);
      }
    } catch (e) {
      // post-stage 门意外抛出（含 StageAlreadyHandled 等）→ 视为该候选一处违规，不让其失败传播。
      gateViolations = Math.max(1, gateViolations);
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    id: candidateId,
    passed: gateViolations === 0,
    qualityScore: typeof qualityScore === 'number' ? qualityScore : undefined,
    gateViolations,
    smokePassed: undefined,
    notes: notes.length ? notes : warnings > 0 ? [`${warnings} warnings`] : undefined,
  };
}
