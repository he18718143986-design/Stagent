import type { FileReadConfig } from '../WorkflowDefinition';
import { DEFAULT_FS_READ_TIMEOUT_MS, pathExists, readTextFile } from '../FsAsync';
import { fileNotFound, invariantViolation } from '../ErrorTypeUtils';
import type { NonLlmToolExecutionParams } from '../WorkflowExecutorTypes';
import { STAGE_ID_ZOOM_OUT } from '../workflow/StageIdPatterns';

export async function runFileReadTool(params: NonLlmToolExecutionParams): Promise<boolean> {
  const { stage, runtime, outKey, instanceKey, resolveTaskFilePath, resolveReadableFilePath } = params;
  const cfg = stage.toolConfig as FileReadConfig;
  if (!cfg.filePath?.trim()) {
    throw invariantViolation(`file-read missing filePath at ${stage.id}`);
  }
  const targetPath = resolveReadableFilePath
    ? resolveReadableFilePath(instanceKey, cfg.filePath)
    : resolveTaskFilePath(instanceKey, cfg.filePath);
  if (!(await pathExists(targetPath))) {
    if (stage.id === STAGE_ID_ZOOM_OUT) {
      const fallback = [
        '# moduleMap (fallback)',
        '',
        `- file-not-found: ${targetPath}`,
        '- zoom_out 使用了最小占位输出；后续决策阶段应提示用户补充模块上下文。',
      ].join('\n');
      runtime.outputs[outKey] = fallback;
      runtime.outputs.content = fallback;
      runtime.outputs._zoomOutFallback = true;
      return true;
    }
    throw fileNotFound(targetPath);
  }
  const content = await readTextFile(targetPath, { timeoutMs: DEFAULT_FS_READ_TIMEOUT_MS });
  runtime.outputs[outKey] = content;
  runtime.outputs.content = content;
  return true;
}
