import type { Stage } from '../WorkflowDefinition';

export function validateDependsOn(stage: Stage, stageOrder: Map<string, number>): string[] {
  const errors: string[] = [];
  const deps = stage.dependsOn;
  if (!deps?.length) {
    return errors;
  }

  const selfIdx = stageOrder.get(stage.id) ?? -1;
  for (const depId of deps) {
    if (!depId?.trim()) {
      errors.push(`阶段 ${stage.id} dependsOn 含空 id`);
      continue;
    }
    const depIdx = stageOrder.get(depId);
    if (depIdx === undefined) {
      errors.push(`阶段 ${stage.id} dependsOn 引用未知阶段: ${depId}`);
    } else if (depIdx >= selfIdx) {
      errors.push(`阶段 ${stage.id} dependsOn 中「${depId}」须出现在 stages[] 中本阶段之前`);
    }
  }

  return errors;
}
