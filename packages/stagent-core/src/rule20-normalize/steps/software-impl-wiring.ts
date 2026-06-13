import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';
import { isSoftwareTaskType } from '../../workflow/TaskType';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../../WorkflowOutputKeys';
import { isStagentBundleWriteStage } from '../../WorkflowDiskBootstrap';
import { isDecideStageId, isImplStageId } from '../../workflow/StageIdPatterns';
import { isLlmTextTool } from '../../workflow/StageToolKinds';
import {
  IMPL_DECISION_CONSTRAINT_SNIPPET,
  findGlobalArchitectureDecisionStage,
  implReferencesDecisionRecordFromStage,
  pairedDecideStageIdForImpl,
} from '../types';

function ensureImplConstraintPrompt(stage: Stage): void {
  if (!isLlmTextTool(stage.tool)) {
    return;
  }
  const tc = stage.toolConfig as { type: 'llm-text'; systemPrompt?: string };
  const prompt = tc.systemPrompt ?? '';
  if (prompt.includes(IMPL_DECISION_CONSTRAINT_SNIPPET)) {
    return;
  }
  const trimmed = prompt.trim();
  tc.systemPrompt = trimmed
    ? `${trimmed}\n\n${IMPL_DECISION_CONSTRAINT_SNIPPET}如发现清单中存在矛盾，在代码注释中标注。`
    : `${IMPL_DECISION_CONSTRAINT_SNIPPET}如发现清单中存在矛盾，在代码注释中标注。`;
}

/** 所有 software llm-text stage_impl_* 补 20-D 约束句（含未参与决策接线的阶段）。 */
export function ensureAllSoftwareImplConstraintPrompts(wf: WorkflowDefinition): void {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return;
  }
  for (const stage of wf.stages) {
    if (!isImplStageId(stage.id) || isStagentBundleWriteStage(stage)) {
      continue;
    }
    if (isLlmTextTool(stage.tool)) {
      ensureImplConstraintPrompt(stage);
    }
  }
}

function prependDecisionRecordSource(
  stage: Stage,
  decideStageId: string,
  label: string,
): void {
  if (implReferencesDecisionRecordFromStage(stage, decideStageId)) {
    return;
  }
  stage.input.sources.unshift({
    type: 'stage-output',
    stageId: decideStageId,
    outputKey: PRIMARY_DECISION_OUTPUT_KEY,
    label,
  });
}

function buildDecideStageIdSet(stages: Stage[]): Set<string> {
  const ids = new Set<string>();
  for (const s of stages) {
    if (s.isDecisionStage && isDecideStageId(s.id)) {
      ids.add(s.id);
    }
  }
  return ids;
}

/**
 * software：为 llm-text stage_impl_* 补 decisionRecord——先同名 stage_decide_<X>，再全局架构。
 */
export function wireSoftwareImplDecisionSources(wf: WorkflowDefinition): void {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return;
  }
  const globalDecide = findGlobalArchitectureDecisionStage(wf.stages);
  const decideIds = buildDecideStageIdSet(wf.stages);

  for (const stage of wf.stages) {
    if (!isImplStageId(stage.id) || isStagentBundleWriteStage(stage)) {
      continue;
    }
    if (stage.exposeAssumptions || !isLlmTextTool(stage.tool)) {
      continue;
    }
    const pairedId = pairedDecideStageIdForImpl(stage.id);
    if (pairedId && decideIds.has(pairedId)) {
      prependDecisionRecordSource(stage, pairedId, '模块决策');
    }
    if (globalDecide) {
      prependDecisionRecordSource(stage, globalDecide.id, '全局架构决策');
    }
  }
}

/** @deprecated 使用 {@link wireSoftwareImplDecisionSources}；保留别名避免外部引用断裂。 */
export function wireOrphanImplStagesToGlobalArchitectureDecision(wf: WorkflowDefinition): void {
  wireSoftwareImplDecisionSources(wf);
  ensureAllSoftwareImplConstraintPrompts(wf);
}
