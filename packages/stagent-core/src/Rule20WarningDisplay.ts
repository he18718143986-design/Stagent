/**
 * 将 `workflowGenerated.warnings` 中的机器可读 token（M14.4 / I-23）
 * 转为确认页可读的短句；原始 token 仍保留在 `warnings` 供日志/脚本解析。
 */

const RULE20_TYPE_LABELS: Record<string, string> = {
  'missing-decision-stage': '缺少决策阶段（decide_*）',
  'broken-naming-pair': '垂直切片命名不完整（decide/test_write/impl/test_run 配对）',
  'missing-decisionRecord-source': '实现阶段未引用 decisionRecord',
  'missing-constraint-prompt': '实现阶段 systemPrompt 缺少决策约束',
  'test-run-must-use-code-runner': '验证阶段须使用 code-runner',
  'test-run-imports-missing-artifact': 'test_run 引用了未落盘的 Python 模块/脚本',
  'software-missing-global-architecture-decision': 'software 任务缺少全局架构决策阶段',
  'exposeAssumptions-exemption': 'exposeAssumptions 豁免提示',
  'model-tier-downgrade': '模型层级降级提示',
  'prototype-missing-verification-stage': 'prototype 缺少验证阶段',
  'prototype-missing-success-criteria': 'prototype 缺少成功标准',
  'prototype-impl-missing-file-read-followup': 'prototype impl 后缺少 file-read 或下游 stage-output 引用',
  'debug-missing-reproduce-stage': 'debug 缺少复现阶段',
  'debug-missing-hypothesis-stage': 'debug 缺少根因假设阶段',
  'debug-missing-verification-stage': 'debug 缺少回归验证阶段',
  'debug-impl-missing-decision-source': 'debug 修复实现未引用决策输出',
  'debug-feedback-loop-not-first': 'debug 复现/验证未排在假设与修复之前（反馈回路优先 I-26）',
  'horizontal-tdd': 'horizontal TDD：测试全在前、实现全在后（建议一切片一循环）',
  'to-issues-missing-chain': 'to-issues 缺少完整切片链',
  'to-issues-missing-verification': 'to-issues 缺少验证阶段',
  'to-issues-monolithic-impl-naming': 'to-issues 实现阶段命名过于单体',
  'to-issues-high-hitl-ratio': 'to-issues 人工闸门比例偏高',
  'to-issues-horizontal-layering': 'to-issues 疑似水平分层反模式',
  'refactor-missing-decision-stage': 'refactor 缺少决策阶段',
  'refactor-missing-verification-stage': 'refactor 缺少验证阶段',
  'refactor-monolithic-impl-naming': 'refactor 实现阶段命名过于单体',
  'dag-unreachable-from-entry': 'DAG 存在从入口不可达的阶段',
  'dag-dependency-cycle-hint': 'DAG 依赖图可能存在环',
  stage_count_near_limit: '阶段数接近上限（>45），建议拆分或精简',
  restored_from_persistence: '已从持久化恢复（非本次 generateWorkflow 校验）',
};

/** M21：契约检查（PrototypeContractLint / CrossFileKeyContractLint）token 标签 */
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  'sample-mock-source-unshared': '样例数据与 mock 数据未共享同一 ASIN 源（应一方引用另一方输出）',
  'impl-missing-decision-source': '数据管道核心 impl 未引用 decisionRecord',
  'weak-integration-assertion': '集成验证仅断言行数，未校验内容正确性（query_status=success / 告警）',
  'cross-file-key-mismatch': '跨文件键名疑似不一致（产出 vs 消费）',
  'non-canonical-key': '键名偏离 CONTEXT.md 权威术语（疑似漂移）',
  'test-no-assertion': '测试缺少断言（无法验证行为）',
  'test-tautological-assertion': '恒真断言（assert True 等，等于没测）',
  'test-tests-implementation': '测试耦合实现/仅断言存在，未测真实行为',
};

export type ParsedWorkflowWarning =
  | { kind: 'rule20-violation'; type: string; stageId: string }
  | { kind: 'rule20-soft'; type: string; stageId: string }
  | { kind: 'contract'; type: string; stageId: string }
  | { kind: 'builtin'; type: string };

export function parseWorkflowWarningLine(line: string): ParsedWorkflowWarning | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const violation = /^rule20:([^:]+):(.+)$/.exec(trimmed);
  if (violation) {
    return { kind: 'rule20-violation', type: violation[1], stageId: violation[2] };
  }
  const soft = /^rule20-soft:([^:]+):(.+)$/.exec(trimmed);
  if (soft) {
    return { kind: 'rule20-soft', type: soft[1], stageId: soft[2] };
  }
  const contract = /^contract:([^:]+):(.+)$/.exec(trimmed);
  if (contract) {
    return { kind: 'contract', type: contract[1], stageId: contract[2] };
  }
  return { kind: 'builtin', type: trimmed };
}

function stageSuffix(stageId: string): string {
  return stageId && stageId !== 'workflow' ? `（${stageId}）` : '';
}

/** 单条 warning token → 确认页展示文案 */
export function formatWorkflowWarningForDisplay(line: string): string {
  const parsed = parseWorkflowWarningLine(line);
  if (!parsed) {
    return line;
  }
  if (parsed.kind === 'builtin') {
    return RULE20_TYPE_LABELS[parsed.type] ?? parsed.type;
  }
  if (parsed.kind === 'contract') {
    const cLabel = CONTRACT_TYPE_LABELS[parsed.type] ?? parsed.type;
    // cross-file-key-mismatch 的 stageId 段实为可读描述，直接拼在标签后
    if (parsed.type === 'cross-file-key-mismatch') {
      return `[契约检查] ${cLabel}：${parsed.stageId}`;
    }
    return `[契约检查] ${cLabel}${stageSuffix(parsed.stageId)}`;
  }
  const label = RULE20_TYPE_LABELS[parsed.type] ?? parsed.type;
  const suffix = stageSuffix(parsed.stageId);
  if (parsed.kind === 'rule20-violation') {
    return `[Rule20 违反] ${label}${suffix}`;
  }
  return `[Rule20 提示] ${label}${suffix}`;
}

export function formatWorkflowGeneratedWarningsForDisplay(warnings: string[] | undefined): string[] {
  if (!warnings?.length) {
    return [];
  }
  return warnings.map(formatWorkflowWarningForDisplay);
}

/** 供 generateWorkflow 调试日志：violations / soft warnings 计数摘要 */
export function summarizeRule20VerifyForLog(verifyResult: {
  violations: unknown[];
  warnings: unknown[];
  passed: boolean;
}): { passed: boolean; violationCount: number; warningCount: number } {
  return {
    passed: verifyResult.passed,
    violationCount: verifyResult.violations.length,
    warningCount: verifyResult.warnings.length,
  };
}
