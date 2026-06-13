/**
 * 内置 QualityGate 共享构造器与阶段判定（从 BuiltinQualityGates.ts 抽出，1.3）。
 */
import type { GateResult } from '../QualityGate';
import type { Stage } from '../WorkflowDefinition';
import { isImplStageId, isTestRunStageId } from '../workflow/StageIdPatterns';

export function block(gateId: string, messages: string[], meta?: Record<string, unknown>): GateResult {
  return { gateId, severity: 'block', messages, meta };
}

export function warn(gateId: string, messages: string[], meta?: Record<string, unknown>): GateResult {
  return { gateId, severity: 'warn', messages, meta };
}

export function isTestRunStage(stage: Stage | undefined): boolean {
  return !!stage && isTestRunStageId(stage.id);
}

export function isImplStage(stage: Stage | undefined): boolean {
  return !!stage && isImplStageId(stage.id);
}
