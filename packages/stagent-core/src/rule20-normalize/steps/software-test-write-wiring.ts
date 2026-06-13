import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';
import { isSoftwareTaskType } from '../../workflow/TaskType';
import { DECISION_ARTIFACTS_OUTPUT_KEY, PRIMARY_DECISION_OUTPUT_KEY } from '../../WorkflowOutputKeys';
import { isStagentBundleWriteStage } from '../../WorkflowDiskBootstrap';
import {
  decideStageIdFromSemanticName,
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromTestWriteStageId,
} from '../../workflow/StageIdPatterns';
import { isLlmTextTool } from '../../workflow/StageToolKinds';
import { hasStageOutputSource } from '../../workflow/StageInputSources';
import { findGlobalArchitectureDecisionStage, pairedDecideStageIdForImpl } from '../types';
import { isDecideStageId } from '../../workflow/StageIdPatterns';

export const TEST_WRITE_CONTRACT_SNIPPET =
  '严格按照 decisionArtifacts.modules 中本模块的 exports 编写测试：仅 from <模块名> import <已声明符号>；禁止发明未在契约 exports 中的符号。';

function prependStageOutputSource(
  stage: Stage,
  decideStageId: string,
  outputKey: string,
  label: string,
): void {
  if (hasStageOutputSource(stage.input.sources, { stageId: decideStageId, outputKey })) {
    return;
  }
  stage.input.sources.unshift({
    type: 'stage-output',
    stageId: decideStageId,
    outputKey,
    label,
  });
}

function ensureTestWriteContractPrompt(stage: Stage): void {
  if (!isLlmTextTool(stage.tool)) {
    return;
  }
  const tc = stage.toolConfig as { type: 'llm-text'; systemPrompt?: string };
  const prompt = tc.systemPrompt ?? '';
  if (prompt.includes(TEST_WRITE_CONTRACT_SNIPPET)) {
    return;
  }
  const trimmed = prompt.trim();
  tc.systemPrompt = trimmed
    ? `${trimmed}\n\n${TEST_WRITE_CONTRACT_SNIPPET}`
    : TEST_WRITE_CONTRACT_SNIPPET;
}

function pairedDecideStageIdForTestWrite(testWriteStageId: string): string {
  const sem = semanticNameFromTestWriteStageId(testWriteStageId);
  return sem ? decideStageIdFromSemanticName(sem) : '';
}

/** software：为 llm-text stage_test_write_* 补 decisionRecord + decisionArtifacts。 */
export function wireSoftwareTestWriteDecisionSources(wf: WorkflowDefinition): void {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return;
  }
  const globalDecide = findGlobalArchitectureDecisionStage(wf.stages);
  const decideIds = buildDecideStageIdSet(wf.stages);

  for (const stage of wf.stages) {
    if (!isTestWriteStageId(stage.id) || !isLlmTextTool(stage.tool)) {
      continue;
    }
    const pairedId = pairedDecideStageIdForTestWrite(stage.id);
    if (pairedId && decideIds.has(pairedId)) {
      prependStageOutputSource(stage, pairedId, PRIMARY_DECISION_OUTPUT_KEY, '模块决策');
      prependStageOutputSource(stage, pairedId, DECISION_ARTIFACTS_OUTPUT_KEY, '模块接口契约');
    }
    if (globalDecide) {
      prependStageOutputSource(stage, globalDecide.id, PRIMARY_DECISION_OUTPUT_KEY, '全局架构决策');
      prependStageOutputSource(stage, globalDecide.id, DECISION_ARTIFACTS_OUTPUT_KEY, '全局模块接口表');
    }
    ensureTestWriteContractPrompt(stage);
  }
}

/** software：为 llm-text stage_impl_* 补 decisionArtifacts（保留既有 decisionRecord 接线）。 */
export function wireSoftwareDecisionArtifactsSources(wf: WorkflowDefinition): void {
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
      prependStageOutputSource(stage, pairedId, DECISION_ARTIFACTS_OUTPUT_KEY, '模块接口契约');
    }
    if (globalDecide) {
      prependStageOutputSource(stage, globalDecide.id, DECISION_ARTIFACTS_OUTPUT_KEY, '全局模块接口表');
    }
  }
}

export function ensureAllSoftwareTestWriteContractPrompts(wf: WorkflowDefinition): void {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return;
  }
  for (const stage of wf.stages) {
    if (isTestWriteStageId(stage.id) && isLlmTextTool(stage.tool)) {
      ensureTestWriteContractPrompt(stage);
    }
  }
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
