import { isImplStageId, isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool, isFileReadTool, isLlmTextTool } from '../workflow/StageToolKinds';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyIssue } from './types';
import { matchesPrototypeEntryScriptInCommand } from '../workflow/EntryScriptHeuristics';

const PROTOTYPE_CORE_IMPL_PATTERN =
  /stage_impl_(?:prototype_)?(?:reader|fetcher|analyzer|writer|main)\b/i;

function isArtifactConsumedByDownstreamRunner(
  stages: WorkflowDefinition['stages'],
  implIdx: number,
  artifactPath: string,
): boolean {
  const base = artifactPath.split(/[\\/]/).pop() ?? artifactPath;
  const moduleName = base.replace(/\.[^.]+$/, '');
  const moduleRe = moduleName ? new RegExp(`\\b${moduleName.replace(/[^\w]/g, '\\$&')}\\b`) : null;
  for (let j = implIdx + 1; j < stages.length; j++) {
    const s = stages[j];
    if (!isCodeRunnerTool(s.tool)) {
      continue;
    }
    const cmd = String((s.toolConfig as { command?: string }).command ?? '');
    if (cmd.includes(base) || (moduleRe && moduleRe.test(cmd)) || matchesPrototypeEntryScriptInCommand(cmd)) {
      return true;
    }
  }
  return false;
}

/** M20.2：核心 prototype impl 落盘后应有 file-read 或下一 impl 的 stage-output 引用 */
export function verifyPrototypeImplFileReadFollowup(workflow: WorkflowDefinition, warnings: VerifyIssue[]): void {
  const stages = workflow.stages;
  const implWithWrite = stages.filter((s) => {
    if (!isLlmTextTool(s.tool) || !isImplStageId(s.id)) {
      return false;
    }
    const out = (s.toolConfig as { writeOutputToFile?: string }).writeOutputToFile;
    return !!out?.trim();
  });
  if (implWithWrite.length < 2) {
    return;
  }

  for (const impl of implWithWrite) {
    if (!PROTOTYPE_CORE_IMPL_PATTERN.test(impl.id)) {
      continue;
    }
    const artifactPath = String((impl.toolConfig as { writeOutputToFile?: string }).writeOutputToFile).trim();
    const implIdx = stages.findIndex((s) => s.id === impl.id);
    if (implIdx < 0) {
      continue;
    }

    let hasFollowup = false;
    for (let j = implIdx + 1; j < stages.length; j++) {
      const next = stages[j];
      if (isTestRunStageId(next.id) || isCodeRunnerTool(next.tool)) {
        break;
      }
      if (isFileReadTool(next.tool)) {
        const fp = String((next.toolConfig as { filePath?: string }).filePath ?? '').trim();
        if (fp === artifactPath) {
          hasFollowup = true;
          break;
        }
      }
      if (isLlmTextTool(next.tool) && isImplStageId(next.id)) {
        const refsImpl = next.input.sources.some(
          (src) => src.type === 'stage-output' && src.stageId === impl.id,
        );
        const refsFile = next.input.sources.some(
          (src) =>
            src.type === 'file' &&
            String(src.filePath ?? '').trim() === artifactPath,
        );
        if (refsImpl || refsFile) {
          hasFollowup = true;
        }
        break;
      }
    }

    if (!hasFollowup && isArtifactConsumedByDownstreamRunner(stages, implIdx, artifactPath)) {
      hasFollowup = true;
    }

    if (!hasFollowup) {
      warnings.push({
        type: 'prototype-impl-missing-file-read-followup',
        stageId: impl.id,
        message: rule20Msg('prototype-impl-missing-file-read-followup', impl.id, artifactPath),
      });
    }
  }
}
