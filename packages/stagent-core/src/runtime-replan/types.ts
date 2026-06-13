import type { Stage, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';
import { RUNTIME_REPLAN_OUTPUT_KEY } from './constants';

export type RuntimeReplanTriggerKind =
  | 'gate-repair-exhausted'
  | 'preflight-pytest-asyncio'
  | 'preflight-conftest'
  | 'fix-exhausted';

export type RuntimeReplanTrigger = {
  kind: RuntimeReplanTriggerKind;
  /** 关联的 stage_test_run_* id */
  testRunStageId: string;
  sliceSemantic: string;
  gateId?: string;
  message?: string;
};

export type RuntimeReplanActionKind = 'insert-after';

export type RuntimeReplanAction = {
  kind: RuntimeReplanActionKind;
  anchorStageId: string;
  stage: Stage;
  trigger: RuntimeReplanTrigger;
  reason: string;
};

export type RuntimeReplanSkipReason =
  | 'anchor-not-found'
  | 'already-inserted'
  | 'runtime-misaligned'
  | 'budget-denied'
  | 'no-plan';

export type RuntimeReplanApplyResult =
  | {
      ok: true;
      instance: WorkflowInstance;
      insertedStageId: string;
      insertIndex: number;
      action: RuntimeReplanAction;
    }
  | {
      ok: false;
      reason: RuntimeReplanSkipReason;
      detail?: string;
    };

export type RuntimeReplanLedger = {
  attempts: number;
  perSlice: Record<string, number>;
  insertedStageIds: string[];
  lastTrigger?: RuntimeReplanTriggerKind;
};

export type RuntimeReplanBudget = {
  maxPerSlice: number;
  maxPerInstance: number;
};

export function emptyReplanLedger(): RuntimeReplanLedger {
  return { attempts: 0, perSlice: {}, insertedStageIds: [] };
}

export function readReplanLedger(outputs: Record<string, unknown>): RuntimeReplanLedger {
  const raw = outputs[RUNTIME_REPLAN_OUTPUT_KEY];
  if (!raw || typeof raw !== 'object') {
    return emptyReplanLedger();
  }
  const o = raw as RuntimeReplanLedger;
  return {
    attempts: typeof o.attempts === 'number' ? o.attempts : 0,
    perSlice: o.perSlice && typeof o.perSlice === 'object' ? { ...o.perSlice } : {},
    insertedStageIds: Array.isArray(o.insertedStageIds) ? [...o.insertedStageIds] : [],
    lastTrigger: o.lastTrigger,
  };
}

export function mergeLedgerIntoRuntime(runtime: StageRuntime, patch: Partial<RuntimeReplanLedger>): void {
  const cur = readReplanLedger(runtime.outputs);
  runtime.outputs[RUNTIME_REPLAN_OUTPUT_KEY] = {
    ...cur,
    ...patch,
    perSlice: { ...cur.perSlice, ...(patch.perSlice ?? {}) },
    insertedStageIds: patch.insertedStageIds ?? cur.insertedStageIds,
  };
}
