import type { WorkflowDefinition } from '../WorkflowDefinition';
import {
  implStageIdFromSemanticName,
  testWriteStageIdFromSemanticName,
} from '../workflow/StageIdPatterns';
import { writeOutputToFileOf } from '../plan-completeness/planCompletenessStageAccess';

export interface SlicePythonPaths {
  testRelPath?: string;
  implRelPath?: string;
}

export function collectSlicePythonPaths(
  definition: WorkflowDefinition,
  semantic: string,
): SlicePythonPaths {
  const testStage = definition.stages.find((s) => s.id === testWriteStageIdFromSemanticName(semantic));
  const implStage = definition.stages.find((s) => s.id === implStageIdFromSemanticName(semantic));
  return {
    testRelPath: testStage ? writeOutputToFileOf(testStage) : undefined,
    implRelPath: implStage ? writeOutputToFileOf(implStage) : undefined,
  };
}
