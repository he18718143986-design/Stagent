import type { WorkflowDefinition } from '../WorkflowDefinition';

/**
 * 中立的自修复缺口探测接口：plan-completeness 不再直接 import workflow-self-heal，
 * 改由装配层（composition root）注入实现，断开 plan-completeness → workflow-self-heal
 * 的静态依赖（受 architecture-interface-ceiling 守卫）。
 */
export type SelfHealGapDetector = (wf: WorkflowDefinition) => string[];

let registeredDetector: SelfHealGapDetector | undefined;

/** 装配层注入真实实现（workflow-self-heal/auditSelfHealGaps）。 */
export function setSelfHealGapDetector(detector: SelfHealGapDetector | undefined): void {
  registeredDetector = detector;
}

/** 探测自修复缺口；未注入实现时返回空（不误报）。 */
export function detectSelfHealGaps(wf: WorkflowDefinition): string[] {
  return registeredDetector ? registeredDetector(wf) : [];
}
