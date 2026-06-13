import type * as vscode from '../platform/HostTypes';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { postHitlActionHint } from './postHitlStageError';
import { HITL_HINT_NO_INSTANCE, HITL_HINT_STAGE_NOT_ACTIONABLE } from './hitlHints';
import { findHitlStage, type HitlStageBinding } from './resolveHitlStage';

export async function withHitlStageBinding(
  host: HitlCoordinatorHost,
  stageId: string,
  panel: vscode.WebviewPanel,
  fn: (binding: HitlStageBinding) => Promise<void> | void,
): Promise<void> {
  host.bindPanel(panel);
  const instance = host.getInstance();
  if (!instance) {
    postHitlActionHint(host, panel, HITL_HINT_NO_INSTANCE, stageId);
    return;
  }
  const binding = findHitlStage(instance, stageId);
  if (!binding) {
    postHitlActionHint(host, panel, HITL_HINT_STAGE_NOT_ACTIONABLE, stageId);
    return;
  }
  await fn(binding);
}
