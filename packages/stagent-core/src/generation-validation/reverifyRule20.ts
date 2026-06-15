import {
  formatRule20ViolationsBlockReason,
  shouldBlockGenerateOnRule20Violations,
} from '../GeneratedWorkflowGate';
import { verifyRule20, type VerifyResult } from '../Rule20Verify';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { StructuralRepairAction } from '../WorkflowStructuralRepair';
import type { GenerationValidationOutcome, PipelineContext } from './types';

export function reverifyRule20AfterChange(
  ctx: PipelineContext,
  wf: WorkflowDefinition,
): VerifyResult | undefined {
  if (!ctx.runtimeRule20On) {
    return undefined;
  }
  return verifyRule20(wf, { horizontalTddFail: ctx.gates?.horizontalTddFail });
}

/** 若 Rule20 violations 应阻断生成，返回对应 outcome；否则 null。 */
export function blockIfRule20Violations(
  ctx: PipelineContext,
  wf: WorkflowDefinition,
  verify: VerifyResult | undefined,
  options: {
    kind: 'rule20-blocked' | 'plan-blocked';
    structuralRepairs?: StructuralRepairAction[];
    extraBlockReasons?: string[];
  },
): GenerationValidationOutcome | null {
  if (!shouldBlockGenerateOnRule20Violations(verify, ctx.runtimeRule20On)) {
    return null;
  }
  const blockReasons = [
    formatRule20ViolationsBlockReason(verify!.violations),
    ...(options.extraBlockReasons ?? []),
  ];
  if (options.kind === 'rule20-blocked') {
    return {
      kind: 'rule20-blocked',
      workflow: wf,
      blockReasons,
      structuralRepairs: options.structuralRepairs,
    };
  }
  return {
    kind: 'plan-blocked',
    workflow: wf,
    blockReasons,
    structuralRepairs: options.structuralRepairs ?? [],
  };
}
