import type { Stage } from '../WorkflowDefinition';
import type { EngineActivityKind } from '../workflow-types/MessageTypes';
import { isDecideStageId, isImplStageId, isTestRunStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';

export function happyPathEngineActivityKind(stage: Stage): EngineActivityKind {
  if (stage.isDecisionStage || isDecideStageId(stage.id)) {
    return 'engine';
  }
  if (isTestWriteStageId(stage.id) || isTestRunStageId(stage.id)) {
    return 'verify';
  }
  if (isImplStageId(stage.id)) {
    return 'engine';
  }
  if (stage.tool === 'code-runner') {
    return 'verify';
  }
  return 'engine';
}

export function happyPathEngineActivityText(stage: Stage): string {
  if (isTestWriteStageId(stage.id)) {
    return `RED 测试已写入：${stage.title}`;
  }
  if (isTestRunStageId(stage.id)) {
    return `验证通过：${stage.title}`;
  }
  if (isImplStageId(stage.id)) {
    return `实现完成：${stage.title}`;
  }
  if (stage.isDecisionStage) {
    return `决策完成：${stage.title}`;
  }
  return `阶段完成：${stage.title}`;
}
