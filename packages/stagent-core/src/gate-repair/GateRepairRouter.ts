import type { GateResult } from '../QualityGate';
import {
  GATE_ID_PYTHON_EXPORT_CONTRACT,
  GATE_ID_PYTHON_PYPI_SYMBOL,
} from '../QualityGateIds';
import type { PythonExportContractIssue } from '../python-contract/PythonExportContractLint';
import type { PythonPypiSymbolIssue } from '../python-contract/PythonPypiSymbolLint';
import { semanticNameFromTestRunStageId } from '../workflow/StageIdPatterns';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

export type GateRepairIssue =
  | { kind: 'python-export-contract'; issue: PythonExportContractIssue }
  | { kind: 'python-pypi-symbol'; issue: PythonPypiSymbolIssue };

const REPAIRABLE_GATE_IDS = new Set<string>([
  GATE_ID_PYTHON_EXPORT_CONTRACT,
  GATE_ID_PYTHON_PYPI_SYMBOL,
]);

export function isRepairableGateBlock(gateId: string): boolean {
  return REPAIRABLE_GATE_IDS.has(gateId);
}

export function parseGateRepairIssue(block: GateResult): GateRepairIssue | null {
  const issue = block.meta?.issue;
  if (!issue || typeof issue !== 'object') {
    return null;
  }
  if (block.gateId === GATE_ID_PYTHON_EXPORT_CONTRACT) {
    return { kind: 'python-export-contract', issue: issue as PythonExportContractIssue };
  }
  if (block.gateId === GATE_ID_PYTHON_PYPI_SYMBOL) {
    return { kind: 'python-pypi-symbol', issue: issue as PythonPypiSymbolIssue };
  }
  return null;
}

export function resolveGateRepairWriteTarget(repair: GateRepairIssue): string | undefined {
  if (repair.kind === 'python-export-contract') {
    return repair.issue.implFile;
  }
  if (repair.kind === 'python-pypi-symbol') {
    return repair.issue.file;
  }
  return undefined;
}

export function buildGateRepairPlaybookSteps(repair: GateRepairIssue): string[] {
  if (repair.kind === 'python-export-contract') {
    return [
      `在 ${repair.issue.implFile ?? 'impl'} 导出 ${repair.issue.symbol}（class/def 或 __all__）`,
      `对齐 tests 中 from ${repair.issue.module} import ${repair.issue.symbol}`,
      '勿臆造第三方 API 符号；仅补齐项目内导出',
    ];
  }
  return [
    `移除 ${repair.issue.package} 不存在的符号 ${repair.issue.symbol}`,
    `改用已核实入口：${repair.issue.suggested}`,
    '更新 DecisionRecord 技术选型与 venv import_check',
  ];
}

export function buildGateRepairSystemPrompt(repair: GateRepairIssue, writeTarget: string): string {
  const steps = buildGateRepairPlaybookSteps(repair).join('\n- ');
  return [
    '你是 gate-repair：在 test_run 前修复 Python 契约问题（非 test_run 失败后修复）。',
    `只修改并输出单个文件 ${writeTarget} 的完整正文。`,
    '修复要点：',
    `- ${steps}`,
    '禁止 Markdown 围栏；禁止 from ctpbee import MdApi / create_md_api。',
  ].join('\n');
}

export function buildGateRepairUserContent(
  repair: GateRepairIssue,
  block: GateResult,
  existingFileContent?: string,
): string {
  const parts = [
    `Gate: ${block.gateId}`,
    `Messages: ${block.messages.join('; ')}`,
    '',
    'Playbook:',
    ...buildGateRepairPlaybookSteps(repair).map((s) => `- ${s}`),
  ];
  if (existingFileContent !== undefined) {
    parts.push('', '--- 当前文件内容 ---', existingFileContent);
  }
  return parts.join('\n');
}

export function findFixStageForTestRun(
  definition: WorkflowDefinition,
  testRunStageId: string,
): Stage | undefined {
  const semantic = semanticNameFromTestRunStageId(testRunStageId);
  if (!semantic) {
    return undefined;
  }
  const fixId = `stage_fix_if_failed_${semantic}`;
  return definition.stages.find((s) => s.id === fixId);
}
