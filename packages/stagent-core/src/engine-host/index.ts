import type * as vscode from '../platform/HostTypes';
import type { ExecutionHostDeps } from './ExecutionHostDeps';
import type { GenerationHostDeps } from './GenerationHostDeps';
import type { MessagingHostDeps } from './MessagingHostDeps';
import type { PersistenceHostDeps } from './PersistenceHostDeps';

export type { MessagingHostDeps } from './MessagingHostDeps';
export type { PersistenceHostDeps } from './PersistenceHostDeps';
export type { GenerationHostDeps } from './GenerationHostDeps';
export type { ExecutionHostDeps } from './ExecutionHostDeps';

/** 引擎 Host 工厂聚合依赖（由 WorkflowEngine 在运行时满足）。 */
export interface EngineHostFactoryDeps
  extends MessagingHostDeps,
    PersistenceHostDeps,
    GenerationHostDeps,
    ExecutionHostDeps {
  context: vscode.ExtensionContext;
  maxStageWarn: number;
  /** 生成序号（防竞态）；由 WorkflowGenerationService 提供。 */
  getGenerationSeq: () => number;
}

export type PreGenerationHostDeps = MessagingHostDeps &
  Pick<GenerationHostDeps, 'ensurePreExecDraftShell' | 'polishCacheKey' | 'rememberPolishCache' | 'invokeLlmRaw'> &
  Pick<PersistenceHostDeps, 'getCurrentInstanceKey'> & {
    getPolishCacheHit: (cacheKey: string) => { text: string; polishedAt: string } | undefined;
  };

export type GenerationRunnerHostDeps = MessagingHostDeps &
  GenerationHostDeps &
  Pick<PersistenceHostDeps, 'resolveExistingDirectoryPath'> & {
    maxStageWarn: number;
  };

export type StartExecutionHostDeps = MessagingHostDeps &
  PersistenceHostDeps &
  ExecutionHostDeps &
  Pick<GenerationHostDeps, 'normalizeWorkflow' | 'resolveReuseInstance'>;

export type HitlHostDeps = MessagingHostDeps &
  PersistenceHostDeps &
  ExecutionHostDeps &
  Pick<PersistenceHostDeps, 'getWorkspaceRootAbsolute'>;

export type ArtifactUiHostDeps = Pick<
  PersistenceHostDeps,
  'getInstance' | 'getCurrentInstanceKey' | 'resolveOutputPath' | 'ensureTaskDir'
>;

export type ResumeCoordinatorHostDeps = MessagingHostDeps &
  PersistenceHostDeps &
  ExecutionHostDeps &
  Pick<PersistenceHostDeps, 'loadInstanceByKey' | 'getDefaultTaskDir'>;

export type MessagingHostFactoryDeps = MessagingHostDeps &
  Pick<PersistenceHostDeps, 'getInstance' | 'getCurrentInstanceKey' | 'getExperiencePersistedForKey' | 'setExperiencePersistedForKey'> & {
    context: vscode.ExtensionContext;
  };
