import { LOG_PREVIEW_RAW_OUTPUT } from '../../LogPreviewLimits';
import { CONTEXT_MD_FILENAME, moduleMapRelativePath, STAGENT_DIR } from '../../paths/StagentPaths';
import { STAGE_ID_ZOOM_OUT } from '../../workflow/StageIdPatterns';
import { isFileReadTool, STAGE_TOOL_LLM_TEXT } from '../../workflow/StageToolKinds';
import { ZOOM_OUT_MODULE_MAP_KEY } from '../../WorkflowOutputKeys';
import type { WorkflowDefinition } from '../../WorkflowDefinition';

/** M25-F2：zoom_out 升级 —— llm-text 模块地图 + 可选 CONTEXT 注入；保留 file-read fallback 当未升级。 */
export function upgradeZoomOutStageToLlmText(wf: WorkflowDefinition, glossaryHint?: string): boolean {
  const stage = wf.stages.find((s) => s.id === STAGE_ID_ZOOM_OUT);
  if (!stage || !isFileReadTool(stage.tool)) {
    return false;
  }
  if (wf.meta?.isGreenfield === true && !glossaryHint?.trim()) {
    return false;
  }
  const glossaryBlock = glossaryHint?.trim()
    ? `\n\nCONTEXT 词汇表（${STAGENT_DIR}/${CONTEXT_MD_FILENAME}）：\n${glossaryHint.slice(0, LOG_PREVIEW_RAW_OUTPUT)}`
    : '';
  stage.tool = STAGE_TOOL_LLM_TEXT;
  stage.toolConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt:
      `你是架构分析师。基于用户任务与代码库，输出 Markdown 模块地图（moduleMap）：主要目录/模块、职责、依赖方向、疑似 ball-of-mud 与 seam 候选。${glossaryBlock}`,
    writeOutputToFile: moduleMapRelativePath(),
    writePathBase: 'workspace',
  };
  if (!stage.outputs.some((o) => o.key === ZOOM_OUT_MODULE_MAP_KEY)) {
    stage.outputs = [{ key: ZOOM_OUT_MODULE_MAP_KEY, format: 'markdown' }];
  }
  return true;
}
