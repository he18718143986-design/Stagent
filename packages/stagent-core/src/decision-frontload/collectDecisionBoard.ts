import type { WorkflowDefinition } from '../WorkflowDefinition';
import {
  loadCharterFromWorkspaceSync,
  DEFAULT_CHARTER_RELATIVE_PATH,
} from '../charter/CharterLoader';
import { readCharterEnabled, readCharterRelativePath } from '../settings/SettingsReaders';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import type { DecisionBoardPayload } from './DecisionFrontloadTypes';
import { buildDecisionBoardPayload } from './buildDecisionBoard';

export { buildDecisionBoardPayload } from './buildDecisionBoard';

/**
 * 生成后收集全部 isDecisionStage，依 Charter 拟答并分类（B-R2 决策前置 pass）。
 * 无决策阶段时返回 null。
 */
export function collectFrontloadDecisionBoard(
  wf: WorkflowDefinition,
  workspaceRoot: string,
): DecisionBoardPayload | null {
  const decisionStages = wf.stages.filter((s) => s.isDecisionStage === true);
  if (decisionStages.length === 0) {
    return null;
  }

  const cfg = getStagentConfiguration();
  const charterEnabled = readCharterEnabled(cfg);
  const charter =
    charterEnabled && workspaceRoot
      ? loadCharterFromWorkspaceSync(workspaceRoot, readCharterRelativePath(cfg) || DEFAULT_CHARTER_RELATIVE_PATH)
      : null;

  return buildDecisionBoardPayload(decisionStages, charter);
}
