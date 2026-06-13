import type { ErrorType } from '../../workflow-types/RuntimeTypes';
import { catalogFallbackTitle } from '../../l10n/catalogMsg';
import { uiMsg } from '../../l10n/uiStrings';
import type { StageErrorEntry } from './types';
import { EXEC_STAGE_ERRORS } from './exec';
import { LLM_STAGE_ERRORS } from './llm';
import { GATES_STAGE_ERRORS } from './gates';
import { HITL_STAGE_ERRORS } from './hitl';
import {
  formatToolExecutionFailedCopy,
  isToolExecutionFailedType,
  type ToolExecutionUserCategory,
} from './toolExecutionCopy';

export type { StageErrorEntry } from './types';
export type { ToolExecutionUserCategory } from './toolExecutionCopy';
export {
  parseCodeRunnerExitCode,
  detectMissingCommand,
  inferToolFromStageId,
  formatToolExecutionFailedCopy,
} from './toolExecutionCopy';

const STAGE_ERROR_CATALOG: Partial<Record<ErrorType, StageErrorEntry>> = {
  ...EXEC_STAGE_ERRORS,
  ...LLM_STAGE_ERRORS,
  ...GATES_STAGE_ERRORS,
  ...HITL_STAGE_ERRORS,
};

export function lookupStageErrorCatalog(errorType: ErrorType): StageErrorEntry | undefined {
  return STAGE_ERROR_CATALOG[errorType];
}

export interface FormatStageErrorOptions {
  stderr?: string;
  stageId?: string;
}

export interface FormattedStageError {
  title: string;
  /** 含原始 error 的调试正文。 */
  body: string;
  /** 面向用户的主文案（error 卡）。 */
  userBody?: string;
  playbookSteps: string[];
  userCategory?: ToolExecutionUserCategory;
  exitCode?: number;
  weakenRetry?: boolean;
}

export function formatStageErrorForUser(
  errorType: ErrorType,
  rawError: string,
  options: FormatStageErrorOptions = {},
): FormattedStageError {
  if (isToolExecutionFailedType(errorType)) {
    const te = formatToolExecutionFailedCopy({
      rawError,
      stderr: options.stderr,
      stageId: options.stageId,
    });
    return {
      title: te.title,
      body: rawError,
      userBody: te.userBody,
      playbookSteps: te.playbookSteps,
      userCategory: te.userCategory,
      exitCode: te.exitCode,
      weakenRetry: te.weakenRetry,
    };
  }

  const entry = lookupStageErrorCatalog(errorType);
  const title = entry?.titleKey ? uiMsg(entry.titleKey) : catalogFallbackTitle();
  const lines: string[] = [];
  if (entry?.hintKey) {
    lines.push(uiMsg(entry.hintKey));
  }
  lines.push(rawError);
  const playbookSteps = entry?.playbookKeys?.map((k) => uiMsg(k)) ?? [];
  return {
    title,
    body: lines.join('\n\n'),
    userBody: entry?.hintKey ? uiMsg(entry.hintKey) : undefined,
    playbookSteps,
  };
}
