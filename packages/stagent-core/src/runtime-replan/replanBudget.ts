import {
  DEFAULT_RUNTIME_REPLAN_MAX_PER_INSTANCE,
  DEFAULT_RUNTIME_REPLAN_MAX_PER_SLICE,
} from './constants';
import type { RuntimeReplanBudget, RuntimeReplanLedger } from './types';

export function defaultRuntimeReplanBudget(): RuntimeReplanBudget {
  return {
    maxPerSlice: DEFAULT_RUNTIME_REPLAN_MAX_PER_SLICE,
    maxPerInstance: DEFAULT_RUNTIME_REPLAN_MAX_PER_INSTANCE,
  };
}

export function aggregateInstanceReplanAttempts(ledger: RuntimeReplanLedger): number {
  return ledger.attempts;
}

export function sliceReplanAttempts(ledger: RuntimeReplanLedger, sliceSemantic: string): number {
  return ledger.perSlice[sliceSemantic] ?? 0;
}

export function canSpendReplanBudget(params: {
  ledger: RuntimeReplanLedger;
  sliceSemantic: string;
  budget?: RuntimeReplanBudget;
}): boolean {
  const budget = params.budget ?? defaultRuntimeReplanBudget();
  if (aggregateInstanceReplanAttempts(params.ledger) >= budget.maxPerInstance) {
    return false;
  }
  if (sliceReplanAttempts(params.ledger, params.sliceSemantic) >= budget.maxPerSlice) {
    return false;
  }
  return true;
}

export function nextLedgerAfterInsert(
  ledger: RuntimeReplanLedger,
  sliceSemantic: string,
  insertedStageId: string,
  triggerKind: RuntimeReplanLedger['lastTrigger'],
): RuntimeReplanLedger {
  return {
    attempts: ledger.attempts + 1,
    perSlice: {
      ...ledger.perSlice,
      [sliceSemantic]: (ledger.perSlice[sliceSemantic] ?? 0) + 1,
    },
    insertedStageIds: [...ledger.insertedStageIds, insertedStageId],
    lastTrigger: triggerKind,
  };
}
