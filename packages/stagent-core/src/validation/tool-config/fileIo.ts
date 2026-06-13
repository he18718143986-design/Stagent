import type { FileReadConfig, FileWriteConfig, WorkflowDefinition } from '../../WorkflowDefinition';
import type { Stage } from '../../WorkflowDefinition';
import { isFileReadTool, isFileWriteTool } from '../../workflow/StageToolKinds';

export function validateFileIoToolConfig(stage: Stage, wf: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (isFileReadTool(stage.tool)) {
    const cfg = stage.toolConfig as Partial<FileReadConfig>;
    if (!cfg.filePath || !String(cfg.filePath).trim()) {
      errors.push(`工具配置错误：阶段 ${stage.id} (file-read) 缺少 filePath`);
    }
  }
  if (isFileWriteTool(stage.tool)) {
    const cfg = stage.toolConfig as Partial<FileWriteConfig>;
    if (!cfg.filePath || !String(cfg.filePath).trim()) {
      errors.push(`工具配置错误：阶段 ${stage.id} (file-write) 缺少 filePath`);
    }
    if (!cfg.sourceOutputKey || !String(cfg.sourceOutputKey).trim()) {
      errors.push(`工具配置错误：阶段 ${stage.id} (file-write) 缺少 sourceOutputKey`);
    }
    if (cfg.sourceStageId?.trim() && !wf.stages.some((s) => s.id === cfg.sourceStageId)) {
      errors.push(`工具配置错误：阶段 ${stage.id} (file-write) sourceStageId 引用未知阶段: ${cfg.sourceStageId}`);
    }
  }
  return errors;
}
