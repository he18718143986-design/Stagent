import type { WorkflowInstance } from '../WorkflowDefinition';

/** autoAI：里程碑验证提示（headless 默认 no-op）。 */
export async function showMilestoneVerifyHintIfAny(_instance: WorkflowInstance): Promise<void> {}
