import type { GateResult } from '../QualityGate';
import { GATE_ID_TEST_RUN_PREFLIGHT } from '../QualityGateIds';
import type { MissingPythonTestInfraIssue } from '../test-infra/missingPythonInfraIssue';
import { semanticNameFromTestRunStageId } from '../workflow/StageIdPatterns';
import type { RuntimeReplanTrigger } from './types';

export function isPreflightPytestAsyncioBlock(block: GateResult): boolean {
  if (block.gateId !== GATE_ID_TEST_RUN_PREFLIGHT) {
    return false;
  }
  const issue = block.meta?.issue;
  if (!issue || typeof issue !== 'object') {
    return false;
  }
  return (issue as MissingPythonTestInfraIssue).code === 'missing-pytest-asyncio';
}

export function isPreflightConftestBlock(block: GateResult): boolean {
  if (block.gateId !== GATE_ID_TEST_RUN_PREFLIGHT) {
    return false;
  }
  const issue = block.meta?.issue;
  if (!issue || typeof issue !== 'object') {
    return false;
  }
  return (issue as MissingPythonTestInfraIssue).code === 'missing-python-flat-layout';
}

export function buildPreflightPytestAsyncioTrigger(testRunStageId: string): RuntimeReplanTrigger | null {
  const semantic = semanticNameFromTestRunStageId(testRunStageId);
  if (!semantic) {
    return null;
  }
  return {
    kind: 'preflight-pytest-asyncio',
    testRunStageId,
    sliceSemantic: semantic,
    message: 'preflight 缺少 pytest-asyncio',
  };
}

export function buildPreflightConftestTrigger(testRunStageId: string): RuntimeReplanTrigger | null {
  const semantic = semanticNameFromTestRunStageId(testRunStageId);
  if (!semantic) {
    return null;
  }
  return {
    kind: 'preflight-conftest',
    testRunStageId,
    sliceSemantic: semantic,
    message: 'preflight 缺少 conftest.py flat-layout bootstrap',
  };
}
