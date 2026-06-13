import type { CodeRunnerConfig } from '../WorkflowDefinition';
import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { humanizeJargon } from './TranslationGlossary';

/**
 * B-R3 G4：从已完成实例提取「如何验收」白话提示（最后一条通过的 test_run + smoke）。
 */
export function buildMilestoneVerifyHint(instance: WorkflowInstance): string | undefined {
  const { definition, stageRuntimes } = instance;
  const parts: string[] = [];

  for (let i = definition.stages.length - 1; i >= 0; i--) {
    const stage = definition.stages[i];
    const rt = stageRuntimes[i];
    if (!stage || !rt || rt.status !== 'done' || !isTestRunStageId(stage.id)) {
      continue;
    }
    if (!isCodeRunnerTool(stage.tool)) {
      continue;
    }
    const cmd = (stage.toolConfig as CodeRunnerConfig).command?.trim();
    if (cmd) {
      parts.push(`复测命令：${humanizeJargon(cmd)}`);
    }
    break;
  }

  const smokeIdx = definition.stages.findIndex((s) => s.id === SMOKE_RUN_STAGE_ID);
  if (smokeIdx >= 0 && stageRuntimes[smokeIdx]?.status === 'done') {
    parts.push('冒烟自检已通过（应用曾真实启动并探活）');
  }

  if (parts.length === 0) {
    return undefined;
  }
  return parts.join('；');
}
