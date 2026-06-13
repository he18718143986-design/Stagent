import type { FileWriteConfig } from '../WorkflowDefinition';
import { readPriorFileContentAsync } from '../ArtifactLifecycleManager';
import { atomicWriteTextFile } from '../FsAsync';
import { invariantViolation } from '../ErrorTypeUtils';
import type { NonLlmToolExecutionParams } from '../WorkflowExecutorTypes';
import { findFileWriteSourceRuntime } from './helpers';

export async function runFileWriteTool(params: NonLlmToolExecutionParams): Promise<boolean> {
  const { stage, runtime, outKey, instance, instanceKey, resolveOutputPath, trackPersistedFile } = params;
  const cfg = stage.toolConfig as FileWriteConfig;
  if (!cfg.filePath?.trim()) {
    throw invariantViolation(`file-write missing filePath at ${stage.id}`);
  }
  if (!cfg.sourceOutputKey?.trim()) {
    throw invariantViolation(`file-write missing sourceOutputKey at ${stage.id}`);
  }
  const sourceRt = findFileWriteSourceRuntime(instance, cfg);
  if (!sourceRt) {
    throw new Error(
      `file-write source output not found: key=${cfg.sourceOutputKey}` +
        (cfg.sourceStageId ? ` stageId=${cfg.sourceStageId}` : ''),
    );
  }
  const content = String(sourceRt.outputs[cfg.sourceOutputKey] ?? '');
  if (!content.trim()) {
    throw new Error(
      `file-write empty content: stage=${stage.id} sourceKey=${cfg.sourceOutputKey} target=${cfg.filePath}`,
    );
  }
  const targetPath = resolveOutputPath(instanceKey, cfg.filePath, cfg.pathBase ?? 'instance');
  const prior = await readPriorFileContentAsync(targetPath);
  await atomicWriteTextFile(targetPath, content);
  trackPersistedFile?.({
    stageId: stage.id,
    outputKey: outKey,
    filePath: targetPath,
    content,
    existedBefore: prior.existedBefore,
    priorContent: prior.priorContent,
  });
  runtime.outputs[outKey] = targetPath;
  return true;
}
