/**
 * 内置 QualityGate 注册 — 将原生成/执行链中的硬编码 lint 统一挂到注册表。
 * 第三方可通过 `registerQualityGate` 追加（如 ESLint / Prettier）。
 *
 * 1.3：具体门定义按阶段拆分至 `quality-gates/{generate,preStage,postStage}Gates.ts`，
 * 本文件仅保留注册/枚举的公开 API（保持对外签名不变）。
 */
import { flattenGateMessages, getDefaultQualityGateRegistry } from './QualityGate';
import { BUILTIN_GENERATE_GATES } from './quality-gates/generateGates';
import { BUILTIN_PRE_STAGE_GATES } from './quality-gates/preStageGates';
import {
  BUILTIN_POST_STAGE_GATES,
  BUILTIN_WORKFLOW_END_GATES,
} from './quality-gates/postStageGates';

export function registerBuiltinQualityGates(
  registry = getDefaultQualityGateRegistry(),
  degraded?: (reason: string, context?: Record<string, unknown>) => void,
): void {
  for (const gate of [
    ...BUILTIN_GENERATE_GATES,
    ...BUILTIN_PRE_STAGE_GATES,
    ...BUILTIN_POST_STAGE_GATES,
    ...BUILTIN_WORKFLOW_END_GATES,
  ]) {
    registry.registerOrReplace(gate);
  }
  // 启动期自检：dependsOn 与 priority/phase/when 是否一致；矛盾仅 degraded 提示，不阻断启动。
  const issues = registry.validateDependencies();
  if (issues.length > 0 && degraded) {
    degraded('quality_gate_dependency_inconsistent', {
      issues: issues.map((i) => `${i.kind}:${i.gateId}->${i.dependsOnId}`),
    });
  }
}

export function listRegisteredQualityGateIds(registry = getDefaultQualityGateRegistry()): string[] {
  return registry.list().map((g) => g.id);
}

export { flattenGateMessages };
