import * as fs from 'fs';
import * as path from 'path';
import type { GateResult } from '../QualityGate';
import { atomicWriteTextFile } from '../FsAsync';
import { normalizeLlmOutputForWritePath } from '../WriteOutputNormalize';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import type { Stage } from '../WorkflowDefinition';
import {
  buildGateRepairSystemPrompt,
  buildGateRepairUserContent,
  parseGateRepairIssue,
  resolveGateRepairWriteTarget,
} from './GateRepairRouter';

const GATE_REPAIR_OUTPUT_KEY = 'gateAutoRepair';
const MAX_GATE_REPAIR_PER_ATTEMPT = 1;

export function gateRepairAttemptCount(outputs: Record<string, unknown>): number {
  const raw = outputs[GATE_REPAIR_OUTPUT_KEY];
  if (!raw || typeof raw !== 'object') {
    return 0;
  }
  const n = (raw as { attempts?: number }).attempts;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function recordGateRepairAttempt(outputs: Record<string, unknown>, gateId: string): void {
  const prev = gateRepairAttemptCount(outputs);
  outputs[GATE_REPAIR_OUTPUT_KEY] = {
    attempts: prev + 1,
    lastGateId: gateId,
    at: new Date().toISOString(),
  };
}

export async function tryGateAutoRepair(params: {
  loopParams: ExecuteNextStageLoopParams;
  testRunStage: Stage;
  stageIndex: number;
  block: GateResult;
  attempt: number;
}): Promise<boolean> {
  const { loopParams, testRunStage, stageIndex, block, attempt } = params;
  const runtime = loopParams.instance.stageRuntimes[stageIndex];
  if (!runtime) {
    return false;
  }
  if (gateRepairAttemptCount(runtime.outputs) >= MAX_GATE_REPAIR_PER_ATTEMPT) {
    return false;
  }

  const repair = parseGateRepairIssue(block);
  const writeTarget = repair ? resolveGateRepairWriteTarget(repair) : undefined;
  const instanceKey = loopParams.currentInstanceKey;
  const wr = loopParams.qualityGateExecutionHost?.getWorkspaceRootAbsolute();
  if (!repair || !writeTarget || !instanceKey || !wr) {
    return false;
  }

  let existingContent: string | undefined;
  const abs = path.join(wr, writeTarget);
  if (fs.existsSync(abs)) {
    existingContent = fs.readFileSync(abs, 'utf8');
  }

  const systemPrompt = buildGateRepairSystemPrompt(repair, writeTarget);
  const userContent = buildGateRepairUserContent(repair, block, existingContent);

  loopParams.debugLog(testRunStage.id, 'gate_auto_repair_start', attempt, {
    gateId: block.gateId,
    writeTarget,
  });

  let text: string;
  try {
    text = await loopParams.executeLlmText(
      `${testRunStage.id}:gate-repair`,
      systemPrompt,
      userContent,
      loopParams.panel,
    );
  } catch (e) {
    loopParams.debugLog(testRunStage.id, 'gate_auto_repair_llm_failed', attempt, {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }

  const normalized = normalizeLlmOutputForWritePath(writeTarget, text);
  if (!normalized.ok) {
    loopParams.debugLog(testRunStage.id, 'gate_auto_repair_normalize_failed', attempt, {
      reason: normalized.reason,
    });
    return false;
  }

  const outAbs = loopParams.resolveOutputPath(instanceKey, writeTarget, 'workspace');
  await atomicWriteTextFile(outAbs, normalized.content);
  recordGateRepairAttempt(runtime.outputs, block.gateId);

  loopParams.debugLog(testRunStage.id, 'gate_auto_repair_written', attempt, {
    writeTarget,
    chars: normalized.content.length,
  });
  loopParams.scheduleSave();
  return true;
}
