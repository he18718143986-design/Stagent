import type { WorkflowDefinition } from './WorkflowDefinition';
import { isValidKnownToolStage, validateToolConfig } from './validation/ToolConfigValidator';
import { validateDecisionStageInvariants } from './validation/DecisionStageValidator';
import { validateDependsOn } from './validation/DependsOnValidator';

export function validateStageConstraints(wf: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const stages = wf.stages ?? [];
  const stageOrder = new Map(stages.map((s, i) => [s.id, i]));

  for (let si = 0; si < stages.length; si++) {
    const stage = stages[si];
    errors.push(...validateToolConfig(stage, wf, si));
    if (!isValidKnownToolStage(stage)) {
      continue;
    }
    errors.push(...validateDecisionStageInvariants(stage));
    errors.push(...validateDependsOn(stage, stageOrder));
  }

  return errors;
}
