import { isImplStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isMainAssemblyStageSemantic } from './PlanCompletenessStageHints';
import {
  CODE_FILE_EXT,
  codeRunnerCommandOf,
  isTestInfraConfigFile,
  semanticOf,
  writeOutputToFileOf,
  relPathBasename,
} from './planCompletenessStageAccess';
import { matchesMainAssemblyCommand } from '../workflow/EntryScriptHeuristics';

export { matchesMainAssemblyCommand };

const ENTRY_OUTPUT_BASENAME = /^(main|index|App)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;
const ENTRY_OUTPUT_PATH_SUFFIX =
  /(?:^|\/)(?:src\/)?index\.(?:ts|tsx|js|jsx|mjs|cjs)$|(?:^|\/)App\.(?:tsx|jsx)$/i;

export const JS_TEST_RUN_CMD =
  /\b(jest|vitest|npx\s+jest|npm\s+test|yarn\s+test|pnpm\s+test|npm\s+run\s+test|yarn\s+run\s+test|pnpm\s+run\s+test)\b/i;

export const PYTHON_TEST_RUN_CMD = /\b(pytest|python\s+-m\s+pytest|python\s+-m\s+unittest|nose\b)/i;

export function matchesEntryOutputPath(filePath: string): boolean {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return false;
  }
  const base = relPathBasename(trimmed);
  if (ENTRY_OUTPUT_BASENAME.test(base)) {
    return true;
  }
  return ENTRY_OUTPUT_PATH_SUFFIX.test(trimmed.replace(/\\/g, '/'));
}

export function matchesMainAssemblyStageId(semantic: string): boolean {
  return isMainAssemblyStageSemantic(semantic);
}

export function codeImplStages(wf: WorkflowDefinition): Stage[] {
  return (wf.stages ?? []).filter((s) => {
    if (!isImplStageId(s.id)) {
      return false;
    }
    const file = writeOutputToFileOf(s);
    return !!file && CODE_FILE_EXT.test(file) && !isTestInfraConfigFile(file);
  });
}

export function hasMainAssemblyStage(wf: WorkflowDefinition): boolean {
  return (wf.stages ?? []).some((s) => {
    if (isImplStageId(s.id)) {
      const file = writeOutputToFileOf(s);
      if (file && matchesEntryOutputPath(file)) {
        return true;
      }
      if (matchesMainAssemblyStageId(semanticOf(s.id))) {
        return true;
      }
    }
    if (isCodeRunnerTool(s.tool)) {
      return matchesMainAssemblyCommand(codeRunnerCommandOf(s));
    }
    return false;
  });
}
