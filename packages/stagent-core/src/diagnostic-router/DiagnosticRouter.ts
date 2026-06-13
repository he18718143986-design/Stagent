import type { GateResult } from '../QualityGate';
import {
  GATE_ID_PYTHON_EXPORT_CONTRACT,
  GATE_ID_PYTHON_PYPI_SYMBOL,
  GATE_ID_PYTHON_VENV_BOOTSTRAP,
  GATE_ID_SDK_PATH_CONTRACT_HARD,
  GATE_ID_TEST_RUN_PREFLIGHT,
} from '../QualityGateIds';
import { isRepairableGateBlock } from '../gate-repair/GateRepairRouter';
import type { MissingPythonTestInfraIssue } from '../test-infra/missingPythonInfraIssue';
import type { DiagnosticRoute } from './types';

function isImportOrSymbolMessage(msg: string): boolean {
  return /import|ModuleNotFound|cannot find module|No module named|symbol|export/i.test(msg);
}

function isAssertionFailure(msg: string): boolean {
  return /assertion|AssertionError|expect\(|FAILED|not equal|pytest/i.test(msg);
}

export function planDiagnosticRouteFromGateBlock(block: GateResult, stageId: string): DiagnosticRoute | null {
  const message = block.messages.join('; ');
  if (block.gateId === GATE_ID_TEST_RUN_PREFLIGHT || block.gateId === GATE_ID_PYTHON_VENV_BOOTSTRAP) {
    const issue = block.meta?.issue as MissingPythonTestInfraIssue | undefined;
    if (issue?.code === 'missing-python-venv' || /exit\s*127|ENOENT|command not found/i.test(message)) {
      return { category: 'config', action: 'bootstrap', reason: message };
    }
    if (issue?.code === 'missing-python-flat-layout' || issue?.code === 'missing-pytest-asyncio') {
      return { category: 'config', action: 'bootstrap', targetStageId: stageId, reason: message };
    }
    return { category: 'config', action: 'escalate_confirm', reason: message };
  }
  if (
    block.gateId === GATE_ID_SDK_PATH_CONTRACT_HARD ||
    block.gateId === GATE_ID_PYTHON_EXPORT_CONTRACT ||
    block.gateId === GATE_ID_PYTHON_PYPI_SYMBOL ||
    isRepairableGateBlock(block.gateId)
  ) {
    return { category: 'symbol', action: 'gate_repair', targetStageId: stageId, reason: message };
  }
  return null;
}

export function planDiagnosticRouteFromStageError(params: {
  stageId: string;
  errorType: string;
  message: string;
  stdout?: string;
  stderr?: string;
}): DiagnosticRoute {
  const combined = [params.message, params.stdout ?? '', params.stderr ?? ''].join('\n');
  if (/exit\s*127|ENOENT|command not found|missing-test-infrastructure|jest\.config|babel\.config/i.test(combined)) {
    return { category: 'config', action: 'bootstrap', targetStageId: params.stageId, reason: params.message };
  }
  if (isImportOrSymbolMessage(combined)) {
    return { category: 'symbol', action: 'gate_repair', targetStageId: params.stageId, reason: params.message };
  }
  if (isAssertionFailure(combined) || params.errorType === 'tool-execution-failed') {
    return { category: 'assertion', action: 'fix_chain', targetStageId: params.stageId, reason: params.message };
  }
  if (/commitment|decision record|职责边界|语义/i.test(combined)) {
    return { category: 'semantic', action: 'reopen_decision', targetStageId: params.stageId, reason: params.message };
  }
  return { category: 'semantic', action: 'escalate_confirm', targetStageId: params.stageId, reason: params.message };
}

export function planRoute(params: {
  gateBlock?: GateResult;
  stageError?: {
    stageId: string;
    errorType: string;
    message: string;
    stdout?: string;
    stderr?: string;
  };
}): DiagnosticRoute | null {
  if (params.gateBlock) {
    return planDiagnosticRouteFromGateBlock(params.gateBlock, params.stageError?.stageId ?? '');
  }
  if (params.stageError) {
    return planDiagnosticRouteFromStageError(params.stageError);
  }
  return null;
}
