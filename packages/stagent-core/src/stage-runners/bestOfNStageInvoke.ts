/**
 * best-of-N 阶段生成胶水（子任务 3b）：对启用的切片跑 N 次候选 →
 * 各候选落盘 + scoreCandidateStrictQa 评分 → selectBestCandidate 选优 → 返回胜者正文。
 * 胜者随后由 runLlmTextStage 既有流程再落盘并经完整门强制（择优不替代门）。
 */
import { invokeLlmTextForStage } from './LlmTextInvokeStep';
import { persistLlmTextOutputs } from './LlmTextPersistStep';
import { scoreCandidateStrictQa } from '../best-of-n/scoreCandidateStrictQa';
import { runBestOfNCandidates } from '../best-of-n/bestOfNStage';
import type { StageStepContext } from './StageStepContext';
import type { PanelLike } from '../WorkflowExecutorTypes';

/** 跑 N 次候选并返回胜者正文（已就 Strict-QA 选优）。仅供单产物、非 decision/patch/bundle 切片调用。 */
export async function invokeBestOfNStageText(
  ctx: StageStepContext,
  attempt: number,
  panel: PanelLike,
  instanceKey: string,
  outKey: string,
  count: number,
): Promise<string> {
  const { params, stage, runtime } = ctx;
  const result = await runBestOfNCandidates(count, async (index) => {
    const id = `attempt-${index + 1}`;
    try {
      const candidateText = await invokeLlmTextForStage(ctx, attempt, panel);
      runtime.outputs[outKey] = candidateText;
      await persistLlmTextOutputs(ctx, attempt, outKey, instanceKey, candidateText);
      const outcome = await scoreCandidateStrictQa(ctx, id, instanceKey);
      return { outcome, payload: candidateText };
    } catch (e) {
      // 候选生成/落盘异常 → 记为最差候选（不阻断其余候选；全失败仍由调用方走既有门路径）。
      return {
        outcome: {
          id,
          passed: false,
          gateViolations: Number.MAX_SAFE_INTEGER,
          notes: [e instanceof Error ? e.message : String(e)],
        },
        payload: '',
      };
    }
  });

  params.debugLog(stage.id, 'best_of_n_selected', attempt, {
    count,
    total: result.summary.total,
    passed: result.summary.passed,
    failed: result.summary.failed,
    anyPassed: result.anyPassed,
    selectedId: result.selection.selectedId,
    reason: result.selection.reason,
    ranked: result.candidates.map((c) => ({
      id: c.outcome.id,
      passed: c.outcome.passed,
      gateViolations: c.outcome.gateViolations,
      qualityScore: c.outcome.qualityScore,
    })),
  });
  params.postMessage(panel, {
    type: 'streamChunk',
    stageId: stage.id,
    chunk: `🎯 best-of-N（N=${count}）：${result.selection.reason}（Strict-QA 通过 ${result.summary.passed}/${result.summary.total}）\n`,
  });

  return result.chosen.payload;
}
