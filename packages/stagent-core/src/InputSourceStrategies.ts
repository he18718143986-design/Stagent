import * as path from 'path';
import type { InputSource, Stage } from './WorkflowDefinition';
import { fileNotFound, stageNotFound } from './ErrorTypeUtils';
import {
  stageOutputToText,
  truncateStageOutputForInput,
} from './WorkflowInputContent';
import type { InputResolverContext, InputResolverDeps } from './WorkflowInputResolver';
import { DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS } from './WorkflowInputResolver';

export type InputSourceStrategy = (
  ctx: InputResolverContext,
  source: InputSource,
  stage: Stage,
  deps: Pick<InputResolverDeps, 'readFileText' | 'fileExists' | 'safeJoinUnderWorkspaceRoot'>,
  truncateTokens: number,
) => Promise<string>;

const inputSourceStrategies: Record<InputSource['type'], InputSourceStrategy> = {
  'user-input': async (ctx) => ctx.definition.meta.userInput,
  constant: async (_ctx, source) => source.value ?? '',
  'stage-output': async (ctx, source, _stage, _deps, truncateTokens) => {
    const idx = ctx.definition.stages.findIndex((s) => s.id === source.stageId);
    if (idx < 0) {
      throw stageNotFound(source.stageId);
    }
    const out = ctx.stageRuntimes[idx].outputs[source.outputKey ?? ''];
    return truncateStageOutputForInput(stageOutputToText(out), truncateTokens);
  },
  'human-answer': async (ctx, source, stage) => {
    const holderId = source.stageId ?? stage.id;
    const idx = ctx.definition.stages.findIndex((s) => s.id === holderId);
    if (idx < 0) {
      throw stageNotFound(holderId);
    }
    return ctx.stageRuntimes[idx].questionAnswers?.[source.questionId ?? ''] ?? '';
  },
  'human-answer-before': async (ctx, source, stage) => {
    const holderId = source.stageId ?? stage.id;
    const idx = ctx.definition.stages.findIndex((s) => s.id === holderId);
    if (idx < 0) {
      throw stageNotFound(holderId);
    }
    return ctx.stageRuntimes[idx].questionBeforeAnswers?.[source.questionId ?? ''] ?? '';
  },
  file: async (ctx, source, _stage, deps) => {
    const rel = source.filePath?.trim();
    if (!rel) {
      return '';
    }
    let absPath: string;
    if (source.pathBase === 'workspace') {
      const wr = ctx.workspaceRoot;
      if (!wr) {
        return `[file:${rel} workspace 根未设置（meta.taskWorkspacePath）]`;
      }
      absPath = deps.safeJoinUnderWorkspaceRoot(wr, rel);
    } else if (ctx.taskDir) {
      absPath = path.join(ctx.taskDir, rel);
    } else {
      return `[file:${rel} 未解析，taskDir 未设置]`;
    }
    if (!(await deps.fileExists(absPath))) {
      throw fileNotFound(absPath);
    }
    return await deps.readFileText(absPath);
  },
};

export async function resolveInputSourceContent(
  ctx: InputResolverContext,
  source: InputSource,
  stage: Stage,
  deps: Pick<InputResolverDeps, 'readFileText' | 'fileExists' | 'safeJoinUnderWorkspaceRoot'>,
  truncateTokens: number = DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
): Promise<string> {
  const strategy = inputSourceStrategies[source.type];
  if (!strategy) {
    return '';
  }
  return strategy(ctx, source, stage, deps, truncateTokens);
}

/** @deprecated 使用 resolveInputSourceContent；保留别名供既有导入。 */
export const contentOfSource = resolveInputSourceContent;
