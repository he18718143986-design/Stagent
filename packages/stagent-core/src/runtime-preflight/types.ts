import type { GateRepairIssue } from '../gate-repair/GateRepairRouter';
import type { RuntimeReplanTrigger } from '../runtime-replan/types';

export type RuntimePreflightLayer = 'plan' | 'decision' | 'disk';

export type RuntimePreflightOutcome =
  | { action: 'continue' }
  | { action: 'bootstrap'; gateId: string; messages: string[] }
  | { action: 'replan'; trigger: RuntimeReplanTrigger }
  | { action: 'gate_repair'; repair: GateRepairIssue }
  | { action: 'escalate_confirm'; issues: string[] }
  | { action: 'reopen_decision'; stageId: string; reason: string }
  | { action: 'failed'; messages: string[] };
