import { PATCH_SEARCH_PREVIEW_CHARS } from './UiListLimits';
import type { PatchInstruction, StageRuntime } from './WorkflowDefinition';
import { fileNotFound } from './ErrorTypeUtils';
import {
  atomicWriteTextFile,
  DEFAULT_FS_READ_TIMEOUT_MS,
  pathExists,
  readTextFile,
} from './FsAsync';
import type { PathHostDeps } from './PathHostDeps';
import type { PathResolverOps } from './PathResolverOps';
import { DEBUG_EVENT_PATCH_FALLBACK, DEBUG_EVENT_PATCH_FILE_MISSING } from './DebugLogEvents';

export function createPatchApplyOps(
  deps: PathHostDeps,
  resolver: Pick<PathResolverOps, 'resolveTaskFilePath'>,
) {
  async function applyPatchInstructions(
    instanceKey: string,
    instructions: PatchInstruction[],
    runtime: StageRuntime,
    outputKey: string,
  ): Promise<void> {
    for (const ins of instructions) {
      const targetPath = resolver.resolveTaskFilePath(instanceKey, ins.filePath);
      if (!(await pathExists(targetPath))) {
        deps.debugLog(runtime.stageId, DEBUG_EVENT_PATCH_FILE_MISSING, runtime.retryCount + 1, {
          filePath: ins.filePath,
        });
        throw fileNotFound(targetPath);
      }
      const current = await readTextFile(targetPath, { timeoutMs: DEFAULT_FS_READ_TIMEOUT_MS });
      if (current.includes(ins.search)) {
        const next = current.split(ins.search).join(ins.replace);
        await atomicWriteTextFile(targetPath, next);
        deps.trackPersistedFile({
          stageId: runtime.stageId,
          outputKey,
          filePath: targetPath,
          content: next,
          existedBefore: true,
          priorContent: current,
        });
        continue;
      }
      const preview = ins.search.slice(0, PATCH_SEARCH_PREVIEW_CHARS).replace(/\s+/g, ' ');
      deps.warn(`patchMode fallback: search 未匹配，file=${ins.filePath}, searchPreview=${preview}`);
      deps.debugLog(runtime.stageId, DEBUG_EVENT_PATCH_FALLBACK, runtime.retryCount + 1, {
        filePath: ins.filePath,
        searchPreview: preview,
      });
      await atomicWriteTextFile(targetPath, ins.replace);
      deps.trackPersistedFile({
        stageId: runtime.stageId,
        outputKey,
        filePath: targetPath,
        content: ins.replace,
        existedBefore: true,
        priorContent: current,
      });
      runtime.outputs[`_patchFallback_${outputKey}`] = true;
      return;
    }
  }

  return { applyPatchInstructions };
}
