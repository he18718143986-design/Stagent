import { DEFAULT_TOOL_PATH_BASE, type PatchInstruction, type ToolPathBase } from '../../WorkflowDefinition';
import { normalizeLlmOutputForWritePath } from '../../WriteOutputNormalize';
import { readPriorFileContentAsync } from '../../ArtifactLifecycleManager';
import {
  atomicWriteTextFile,
  DEFAULT_FS_READ_TIMEOUT_MS,
  pathExists,
  readTextFile,
} from '../../FsAsync';
import { LOG_PREVIEW_RAW_OUTPUT } from '../../LogPreviewLimits';
import { postStageError, llmInvalidOutputStageError } from '../../WorkflowStageErrorHelpers';
import { StageAlreadyHandledError } from '../StageControlSignals';
import type { StageStepContext } from '../StageStepContext';
import {
  DEBUG_EVENT_WRITE_OUTPUT_INTEGRITY_MISMATCH,
  DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_REUSE_ALL,
  DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_WRITE,
} from '../../DebugLogEvents';
import { assessWriteOutputIntegrity, WriteOutputIntegrityMismatchError } from './writeOutputIntegrityAssess';
import { readWriteOutputIntegrityMode } from './writeOutputIntegrity';
import { resolvePrimaryWriteContent } from './multiFileOutputParse';

export type WriteLlmOutputOptions = {
  /** 落盘完整性重试后仍 mismatch 时阻断阶段（不再抛出让上层重试）。 */
  integrityFailClosed?: boolean;
};

export async function writeLlmOutputToFile(
  ctx: StageStepContext,
  attempt: number,
  outKey: string,
  instanceKey: string,
  tc: {
    writeOutputToFile?: string;
    writePathBase?: ToolPathBase;
    additionalWriteTargets?: string[];
  },
  text: string,
  options?: WriteLlmOutputOptions,
): Promise<void> {
  const { params, stage, runtime, instance, panel } = ctx;
  const { postMessage, scheduleSave, debugLog, resolveOutputPath, trackPersistedFile } = params;
  const { definition } = instance;

  const base: ToolPathBase = tc.writePathBase ?? DEFAULT_TOOL_PATH_BASE;
  const absPath = resolveOutputPath(instanceKey, tc.writeOutputToFile!, base);
  const reuse = definition.meta.reuseStrategy ?? 'regenerate';
  const fileExists = await pathExists(absPath);
  const { primaryContent, additionalFiles } = resolvePrimaryWriteContent(
    tc.writeOutputToFile!,
    text,
    tc.additionalWriteTargets,
  );
  const normalized = normalizeLlmOutputForWritePath(tc.writeOutputToFile!, primaryContent);
  if (!normalized.ok) {
    postStageError(
      panel,
      postMessage,
      runtime,
      llmInvalidOutputStageError(stage.id, `writeOutputToFile: ${normalized.reason}`, {
        rawOutput: text.slice(0, LOG_PREVIEW_RAW_OUTPUT),
      }),
    );
    runtime.status = 'error';
    instance.status = 'failed';
    scheduleSave();
    throw new StageAlreadyHandledError('write-output-normalize-failed');
  }
  const toWrite = normalized.content;

  if (fileExists && reuse === 'reuse-all') {
    const existing = await readTextFile(absPath, { timeoutMs: DEFAULT_FS_READ_TIMEOUT_MS });
    runtime.outputs[outKey] = existing;
    debugLog(stage.id, DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_REUSE_ALL, attempt, {
      path: absPath,
      chars: existing.length,
    });
    postMessage(panel, {
      type: 'stageOutputUpdate',
      stageId: stage.id,
      outputKey: outKey,
      content: existing,
    });
    postMessage(panel, {
      type: 'streamChunk',
      stageId: stage.id,
      chunk: `♻️ 复用已有文件（跳过写入）：${absPath}\n`,
    });
  } else {
    const integrityMode = readWriteOutputIntegrityMode();
    const integrity = assessWriteOutputIntegrity(text.length, toWrite.length);
    if (integrityMode !== 'off' && integrity === 'mismatch') {
      debugLog(stage.id, DEBUG_EVENT_WRITE_OUTPUT_INTEGRITY_MISMATCH, attempt, {
        path: absPath,
        rawChars: text.length,
        writtenChars: toWrite.length,
        mode: integrityMode,
      });
      if (integrityMode === 'retry') {
        if (!options?.integrityFailClosed) {
          throw new WriteOutputIntegrityMismatchError(text.length, toWrite.length, tc.writeOutputToFile!);
        }
        postStageError(
          panel,
          postMessage,
          runtime,
          llmInvalidOutputStageError(
            stage.id,
            `writeOutputToFile: 落盘内容与 LLM 输出严重不一致（raw=${text.length} written=${toWrite.length}）`,
            { rawOutput: text.slice(0, LOG_PREVIEW_RAW_OUTPUT) },
          ),
        );
        runtime.status = 'error';
        instance.status = 'failed';
        scheduleSave();
        throw new StageAlreadyHandledError('write-output-integrity-failed');
      }
      postMessage(panel, {
        type: 'streamChunk',
        stageId: stage.id,
        chunk: `⚠️ 落盘完整性警告：LLM ${text.length} 字符 → 写入 ${toWrite.length} 字符（${tc.writeOutputToFile}）\n`,
      });
    }
    const prior = await readPriorFileContentAsync(absPath);
    await atomicWriteTextFile(absPath, toWrite);
    trackPersistedFile?.({
      stageId: stage.id,
      outputKey: outKey,
      filePath: absPath,
      content: toWrite,
      existedBefore: prior.existedBefore,
      priorContent: prior.priorContent,
    });
    debugLog(stage.id, DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_WRITE, attempt, {
      path: absPath,
      chars: toWrite.length,
    });
    postMessage(panel, {
      type: 'stageOutputUpdate',
      stageId: stage.id,
      outputKey: outKey,
      content: toWrite,
    });
    postMessage(panel, {
      type: 'streamChunk',
      stageId: stage.id,
      chunk: `💾 代码已写入：${absPath}\n`,
    });
    runtime.outputs[outKey] = toWrite;

    for (const [relPath, content] of additionalFiles) {
      const extraNorm = normalizeLlmOutputForWritePath(relPath, content);
      if (!extraNorm.ok) {
        continue;
      }
      const extraAbs = resolveOutputPath(instanceKey, relPath, base);
      const extraPrior = await readPriorFileContentAsync(extraAbs);
      await atomicWriteTextFile(extraAbs, extraNorm.content);
      trackPersistedFile?.({
        stageId: stage.id,
        outputKey: outKey,
        filePath: extraAbs,
        content: extraNorm.content,
        existedBefore: extraPrior.existedBefore,
        priorContent: extraPrior.priorContent,
      });
      debugLog(stage.id, DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_WRITE, attempt, {
        path: extraAbs,
        chars: extraNorm.content.length,
        additional: true,
      });
      postMessage(panel, {
        type: 'streamChunk',
        stageId: stage.id,
        chunk: `💾 附加文件已写入：${extraAbs}\n`,
      });
    }
  }
}

export async function applyLlmPatchMode(
  ctx: StageStepContext,
  outKey: string,
  instanceKey: string,
  text: string,
): Promise<void> {
  const { params, stage, runtime, instance, panel } = ctx;
  const { postMessage, scheduleSave, applyPatchInstructions } = params;

  let instructions: PatchInstruction[];
  try {
    instructions = JSON.parse(text) as PatchInstruction[];
    if (!Array.isArray(instructions)) {
      throw new Error('patch instruction must be array');
    }
  } catch (e) {
    postStageError(
      panel,
      postMessage,
      runtime,
      llmInvalidOutputStageError(stage.id, `patchMode 输出不是合法 PatchInstruction[]：${String(e)}`, {
        rawOutput: text,
      }),
    );
    runtime.status = 'error';
    instance.status = 'failed';
    scheduleSave();
    throw new StageAlreadyHandledError('patch-mode-invalid-json');
  }
  await applyPatchInstructions(instanceKey, instructions, runtime, outKey);
}
