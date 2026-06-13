import { isImplStageId, isTestRunStageId, isTestWriteStageId } from './StageIdPatterns';
import type { Stage } from '../WorkflowDefinition';

export type AgentRole = 'decision' | 'implementation' | 'test-write' | 'lightweight' | 'default';

export type StageKind = 'decision' | 'impl' | 'test' | 'other';

export function classifyStageKind(stage: Stage): StageKind {
  if (stage.isDecisionStage) {
    return 'decision';
  }
  if (isImplStageId(stage.id)) {
    return 'impl';
  }
  if (isTestRunStageId(stage.id) || isTestWriteStageId(stage.id)) {
    return 'test';
  }
  return 'other';
}

export function classifyStageRole(stage: Stage): AgentRole {
  if (stage.isDecisionStage) {
    return 'decision';
  }
  if (isTestWriteStageId(stage.id)) {
    return 'test-write';
  }
  if (isImplStageId(stage.id)) {
    return 'implementation';
  }
  if (/^stage_(zoom|doc|polish|summary)/.test(stage.id)) {
    return 'lightweight';
  }
  return 'default';
}
