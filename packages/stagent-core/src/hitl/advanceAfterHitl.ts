import type * as vscode from '../platform/HostTypes';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';

export async function advanceStageAfterHitl(
  host: HitlCoordinatorHost,
  panel: vscode.WebviewPanel,
): Promise<void> {
  await host.executeNextStage(panel);
}
