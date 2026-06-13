import { ArtifactLifecycleManager } from './ArtifactLifecycleManager';
import type { WorkflowInstance } from './WorkflowDefinition';

/** P0-5：从 WorkflowEngine 抽出的 artifact 追踪桥接。 */
export function ensureArtifactRegistryForInstance(instance: WorkflowInstance): ArtifactLifecycleManager {
  if (!instance.artifactRegistry) {
    instance.artifactRegistry = [];
  }
  return new ArtifactLifecycleManager(instance.artifactRegistry);
}

export function trackPersistedFileForInstance(
  instance: WorkflowInstance | undefined,
  input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  },
): void {
  if (!instance) {
    return;
  }
  ensureArtifactRegistryForInstance(instance).trackPersistedFile(input);
}
