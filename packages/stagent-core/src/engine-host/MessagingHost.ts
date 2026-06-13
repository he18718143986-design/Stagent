import type { WorkflowInstance } from '../WorkflowDefinition';

/** postMessage 副作用链窄宿主（从 WorkflowEngineMessaging 抽出，打破环依赖）。 */
export interface MessagingHost {
  getInstance(): WorkflowInstance | undefined;
  getCurrentInstanceKey(): string | undefined;
  getGlobalStorageFsPath(): string;
  getExperiencePersistedForKey(): string | undefined;
  setExperiencePersistedForKey(key: string | undefined): void;
  warn(message: string): void;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  logUserAction(kind: string, detail: Record<string, unknown>): void;
  flushMetrics?(reason: string): void;
}
