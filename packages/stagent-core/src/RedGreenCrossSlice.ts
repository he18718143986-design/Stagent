import {
  isImplStageId,
  isTestWriteStageId,
  testWriteStageIdFromSemanticName,
} from './workflow/StageIdPatterns';
import { semanticOfStage } from './RedGreenGate';
import type { Stage, StageRuntime, WorkflowDefinition } from './WorkflowDefinition';

/** llm-text impl 阶段的落盘目标（用于检测多切片共享同一模块）。 */
export function implWriteTarget(stage: Stage): string | undefined {
  const tc = stage.toolConfig;
  if (tc?.type !== 'llm-text') {
    return undefined;
  }
  const path = (tc as { writeOutputToFile?: string }).writeOutputToFile?.trim();
  return path || undefined;
}

export interface CrossSliceBleedingInfo {
  bleeding: boolean;
  priorImplStageId?: string;
  testWriteStageId?: string;
}

/**
 * 检测「跨切片渗漏」：test_write_X 在更早的 impl_Y（同落盘文件）之后改写测试，
 * 配对测试在 impl_X 前已 GREEN —— 通常是 impl_Y 实现范围超出切片 X，而非空测试。
 */
export function detectCrossSliceBleeding(input: {
  workflow: WorkflowDefinition;
  stageRuntimes: StageRuntime[];
  implStage: Stage;
}): CrossSliceBleedingInfo {
  const sem = semanticOfStage(input.implStage.id);
  if (!sem) {
    return { bleeding: false };
  }

  const stages = input.workflow.stages ?? [];
  const implIdx = stages.findIndex((s) => s.id === input.implStage.id);
  if (implIdx < 0) {
    return { bleeding: false };
  }

  const testWriteId = testWriteStageIdFromSemanticName(sem);
  const testWriteIdx = stages.findIndex((s) => s.id === testWriteId);
  if (testWriteIdx < 0 || !isTestWriteStageId(testWriteId)) {
    return { bleeding: false };
  }

  const testWriteRt = input.stageRuntimes[testWriteIdx];
  if (testWriteRt?.status !== 'done') {
    return { bleeding: false };
  }

  const implTarget = implWriteTarget(input.implStage);
  if (!implTarget) {
    return { bleeding: false };
  }

  for (let i = 0; i < testWriteIdx; i++) {
    const st = stages[i];
    if (!isImplStageId(st.id)) {
      continue;
    }
    if (semanticOfStage(st.id) === sem) {
      continue;
    }
    if (implWriteTarget(st) !== implTarget) {
      continue;
    }
    const rt = input.stageRuntimes[i];
    if (rt?.status !== 'done') {
      continue;
    }
    return {
      bleeding: true,
      priorImplStageId: st.id,
      testWriteStageId: testWriteId,
    };
  }

  return { bleeding: false };
}
