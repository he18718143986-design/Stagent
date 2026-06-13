import { uiMsg } from '../l10n/uiStrings';
import { userHintsMultiModuleOrFullProject } from '../rule20/architecture';
import type { ConfirmDialog } from './confirmDialogAdapter';

/** 多模块/完整项目启发式：用户取消则返回 false。 */
export async function confirmLargeProjectGeneration(
  userInput: string,
  showConfirm: ConfirmDialog,
): Promise<boolean> {
  if (!userHintsMultiModuleOrFullProject(userInput)) {
    return true;
  }
  const continueLabel = uiMsg('stagent.action.continueGenerate');
  const cancelLabel = uiMsg('stagent.action.cancel');
  const choice = await showConfirm(
    uiMsg('stagent.warn.longWorkflowConfirm'),
    continueLabel,
    cancelLabel,
  );
  return choice === continueLabel;
}
