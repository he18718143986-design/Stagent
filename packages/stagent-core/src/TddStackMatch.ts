import type { CodeRunnerConfig, Stage } from './WorkflowDefinition';
import {
  isBundleWriteStageId,
  isSelfHealStageId,
} from './workflow-self-heal/SelfHealStageFactory';
import { isDecideStageId, isImplStageId } from './workflow/StageIdPatterns';
import { isCodeRunnerTool } from './workflow/StageToolKinds';
import { codeRunnerCommandOf, writeOutputToFileOf } from './workflow/StageToolConfigAccess';
import { parseTestRunWorkingDir } from './structural-repair/helpers';
import { findLastImplStageIndex, resolveTddSliceBounds } from './TddSliceScope';
import type { WorkflowDefinition } from './WorkflowDefinition';

/** 栈根目录：`server` / `mobile`；`''` 表示工作区根；`null` 表示无法推断。 */
export type StackRoot = string | null;

function normalizeStackSegment(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function stackFromWriteOutputPath(filePath: string): StackRoot {
  const normalized = normalizeStackSegment(filePath.trim());
  if (!normalized) {
    return null;
  }
  const slash = normalized.indexOf('/');
  if (slash < 0) {
    return '';
  }
  return normalized.slice(0, slash);
}

function stackFromCodeRunnerConfig(stage: Stage): StackRoot {
  if (!isCodeRunnerTool(stage.tool)) {
    return null;
  }
  const cfg = stage.toolConfig as CodeRunnerConfig;
  const cmd = codeRunnerCommandOf(stage);
  if (cmd) {
    const cd = parseTestRunWorkingDir(cmd);
    if (cd !== undefined) {
      return cd;
    }
  }
  const wd = cfg.workingDir?.trim();
  if (wd && wd !== '.') {
    return normalizeStackSegment(wd);
  }
  return null;
}

/** 从 test_run（code-runner）推断栈：`cd server && …` → `server`。 */
export function inferStackFromTestRunStage(stage: Stage): StackRoot {
  return stackFromCodeRunnerConfig(stage);
}

/** 从 impl 推断栈：优先 writeOutputToFile 首段（`server/src/x.ts` → `server`）。 */
export function inferStackFromImplStage(stage: Stage): StackRoot {
  const outFile = writeOutputToFileOf(stage);
  if (outFile) {
    return stackFromWriteOutputPath(outFile);
  }
  return stackFromCodeRunnerConfig(stage);
}

function stacksMatch(target: StackRoot, candidate: StackRoot): boolean {
  return target !== null && candidate !== null && target === candidate;
}

/**
 * 混栈切片：优先同栈 impl（方案 B），无法匹配时 fallback 到位置最近的 impl。
 */
export function findBestImplStageIndex(
  definition: WorkflowDefinition,
  anchorIdx: number,
  testRunStage: Stage,
): number {
  const fallback = findLastImplStageIndex(definition.stages, anchorIdx);
  const targetStack = inferStackFromTestRunStage(testRunStage);
  if (targetStack === null) {
    return fallback;
  }

  const { start, end } = resolveTddSliceBounds(definition, anchorIdx);
  let lastSameStack = -1;
  for (let i = start; i < anchorIdx && i < end; i++) {
    const s = definition.stages[i]!;
    if (isDecideStageId(s.id)) {
      continue;
    }
    if (!isImplStageId(s.id) || isBundleWriteStageId(s.id) || isSelfHealStageId(s.id)) {
      continue;
    }
    const implStack = inferStackFromImplStage(s);
    if (stacksMatch(targetStack, implStack)) {
      lastSameStack = i;
    }
  }

  return lastSameStack >= 0 ? lastSameStack : fallback;
}
