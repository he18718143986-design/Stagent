import { isImplStageId } from './workflow/StageIdPatterns';
import type { Stage, StageRuntime, WorkflowDefinition } from './WorkflowDefinition';
import { gateMsg } from './l10n/gateMsg';
import {
  evaluateRedGreen,
  findPairedTestStage,
  interpretRedFromExitCode,
  semanticOfStage,
  type RedGreenEvaluation,
  type RedGreenMode,
} from './RedGreenGate';

/**
 * M22-F2：impl 前 RED 完整子状态机（扩展 preImplRedConfirm）。
 * warn / hard 均可在需要时跑配对测试；已 red-confirmed 的切片在非 retry 时跳过重复跑。
 */

export type ImplRedFsmPhase = 'skip' | 'run-paired-test' | 'evaluate';

export interface ImplRedFsmPlan {
  phase: ImplRedFsmPhase;
  pairedStage?: Stage;
  mode: RedGreenMode;
  /** 跳过跑测但仍视为通过（本切片已 RED 确认） */
  skipRunAlreadyConfirmed?: boolean;
}

export function planImplRedFsm(
  stage: Stage,
  workflow: WorkflowDefinition,
  mode: RedGreenMode,
  runtime: StageRuntime,
): ImplRedFsmPlan {
  if (mode === 'off' || !isImplStageId(stage.id)) {
    return { phase: 'skip', mode };
  }
  const paired = findPairedTestStage(workflow, stage.id);
  if (!paired || paired.toolConfig?.type !== 'code-runner') {
    return { phase: 'skip', mode };
  }
  const sem = semanticOfStage(stage.id);
  const slice = runtime.redGreenSlice;
  const retrying = (runtime.retryCount ?? 0) > 0 && !!runtime.retryComment?.trim();
  if (
    sem &&
    slice?.semantic === sem &&
    slice.phase === 'red-confirmed' &&
    !retrying
  ) {
    return { phase: 'skip', mode, skipRunAlreadyConfirmed: true };
  }
  return { phase: 'run-paired-test', pairedStage: paired, mode };
}

export function evaluateImplRedConfirmResult(input: {
  mode: RedGreenMode;
  exitCode: number;
  threw: boolean;
}): RedGreenEvaluation {
  if (input.threw) {
    return { outcome: 'pass', reason: gateMsg('redGreen.pairedTestExecException') };
  }
  return evaluateRedGreen({
    mode: input.mode,
    pairedTestExists: true,
    ranTest: true,
    red: interpretRedFromExitCode(input.exitCode),
  });
}

export function applyRedGreenFsmResult(
  runtime: StageRuntime,
  stageId: string,
  evaluation: RedGreenEvaluation,
): void {
  const sem = semanticOfStage(stageId);
  if (!sem) {
    return;
  }
  if (evaluation.outcome === 'block') {
    runtime.redGreenSlice = { semantic: sem, phase: 'blocked-green' };
    return;
  }
  if (evaluation.outcome === 'pass' || evaluation.outcome === 'warn') {
    runtime.redGreenSlice = { semantic: sem, phase: 'red-confirmed' };
  }
}

/** @deprecated 使用 planImplRedFsm */
export function planImplRedConfirm(
  stage: Stage,
  workflow: WorkflowDefinition,
  mode: RedGreenMode,
): ImplRedFsmPlan {
  return planImplRedFsm(stage, workflow, mode, {
    stageId: stage.id,
    status: 'pending',
    outputs: {},
    retryCount: 0,
  });
}

export function shouldEmitRedGreenWarning(evaluation: RedGreenEvaluation): boolean {
  return evaluation.outcome === 'warn';
}

export function shouldBlockOnRedGreen(evaluation: RedGreenEvaluation): boolean {
  return evaluation.outcome === 'block';
}
