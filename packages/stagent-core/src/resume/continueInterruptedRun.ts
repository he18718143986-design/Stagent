import type { WebviewPanel } from '../platform/HostTypes';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { resolveEffectiveEnableDagScheduler } from '../EffectiveSettings';
import { syncInstanceStagePosition } from '../WorkflowStagePosition';
import { resetInterruptedExecutionStages } from '../WorkflowRecoveryViewModel';
import { uiMsg } from '../l10n/uiStrings';
import type { ResumeCoordinatorHost } from './types';

export async function continueInterruptedRunIfNeeded(
  host: ResumeCoordinatorHost,
  panel: WebviewPanel,
  instance: WorkflowInstance,
): Promise<void> {
  if (instance.status !== 'running') {
    return;
  }
  const resetIndices = resetInterruptedExecutionStages(instance);
  if (resetIndices.length > 0) {
    syncInstanceStagePosition(instance);
    const dag = resolveEffectiveEnableDagScheduler(instance.definition.globalConfig);
    host.warn(
      dag ? uiMsg('stagent.info.dagResumeInterrupted') : uiMsg('stagent.info.resumeInterrupted'),
    );
  }
  await host.executeNextStage(panel);
}
