import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import {
  isImplStageId,
  semanticNameFromImplStageId,
  semanticNameFromTddStageId,
} from '../workflow/StageIdPatterns';

const SCOPE_MARKER = '【本切片范围 — 引擎注入';

function collectSliceSemanticNames(stages: WorkflowDefinition['stages']): string[] {
  const names = new Set<string>();
  for (const s of stages ?? []) {
    const n = semanticNameFromTddStageId(s.id);
    if (n) {
      names.add(n);
    }
  }
  return [...names];
}

function buildScopeBlock(stageId: string, sliceName: string, otherSlices: string[]): string {
  const forbidden =
    otherSlices.length > 0
      ? otherSlices.map((n) => `「${n}」`).join('、')
      : '（工作流中无其他命名切片）';
  return [
    SCOPE_MARKER,
    `- 本阶段：${stageId}，垂直切片「${sliceName}」`,
    `- 仅实现本切片验收条件（AC）；落盘文件与测试须与本切片 test_write 一致`,
    `- 禁止实现其他切片行为：${forbidden}`,
    `- 禁止超前实现：不得写入尚未进入本切片 RED 阶段的测试所要求的行为（防 I-25 跨切片写绿）`,
    '】',
  ].join('\n');
}

/** 为 stage_impl_* 注入本切片 AC 范围块（normalize 期，幂等）。 */
export function injectImplSliceScopePrompts(wf: WorkflowDefinition): WorkflowDefinition {
  const stages = wf.stages ?? [];
  const sliceNames = collectSliceSemanticNames(stages);
  if (sliceNames.length === 0) {
    return wf;
  }

  for (const stage of stages) {
    if (!isImplStageId(stage.id) || !isLlmTextTool(stage.tool)) {
      continue;
    }
    const sliceName = semanticNameFromImplStageId(stage.id);
    if (!sliceName) {
      continue;
    }
    const tc = stage.toolConfig as { type: 'llm-text'; systemPrompt?: string };
    const prompt = tc.systemPrompt ?? '';
    if (prompt.includes(SCOPE_MARKER)) {
      continue;
    }
    const others = sliceNames.filter((n) => n !== sliceName);
    const block = buildScopeBlock(stage.id, sliceName, others);
    tc.systemPrompt = `${prompt.trim()}\n\n${block}`;
  }

  return wf;
}
