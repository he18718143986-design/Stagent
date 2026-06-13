import type { ToolPathBase, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';

/** 实例 CRUD、路径解析与落盘。 */
export interface PersistenceHostDeps {
  getInstance: () => WorkflowInstance | undefined;
  setInstance: (instance: WorkflowInstance | undefined) => void;
  getCurrentInstanceKey: () => string | undefined;
  setCurrentInstanceKey: (key: string | undefined) => void;
  clearSaveTimer: () => void;
  scheduleSave: () => void;
  persistMilestone: () => void;
  persistInstanceSnapshot: (key: string, inst: WorkflowInstance) => void;
  notifyInstancesChanged: () => void;
  workspaceFolderPath: () => string | undefined;
  resolveExistingDirectoryPath: (
    raw: string,
  ) => { ok: true; abs: string } | { ok: false; reason: string };
  expandUserHomePath: (raw: string) => string;
  getDefaultTaskDir: (instanceId: string) => string;
  resolveInitialTaskDirForStart: (
    instanceId: string,
    wf: WorkflowDefinition,
  ) => { ok: true; dir: string } | { ok: false; reason: string };
  loadInstanceByKey: (instanceKey: string) => WorkflowInstance | undefined;
  deleteInstance: (instanceKey: string, scope?: 'record' | 'artifacts' | 'folder') => void;
  getWorkspaceRootAbsolute: () => string | undefined;
  resolveOutputPath: (instanceKey: string, filePath: string, base?: ToolPathBase) => string;
  ensureTaskDir: (instanceKey: string) => string;
  trackPersistedFile: (input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }) => void;
  getExperiencePersistedForKey: () => string | undefined;
  setExperiencePersistedForKey: (key: string | undefined) => void;
}
