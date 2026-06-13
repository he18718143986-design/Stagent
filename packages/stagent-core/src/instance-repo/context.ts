/**
 * 实例仓库共享上下文与任务目录解析（从 WorkflowInstanceRepository.ts 抽出，1.3）。
 */
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import {
  getDefaultTaskDir as getDefaultTaskDirFromPersistence,
  type InstanceTaskDirHint,
} from '../WorkflowPersistence';
import { resolveInitialTaskDir } from '../WorkflowPathResolver';

export interface InstanceRepositoryContext {
  workspaceFolderPath: () => string | undefined;
  globalStorageFsPath: string;
  extensionDir: string;
  globalStateKeys: () => Iterable<string>;
  getGlobalStateInstance: (instanceKey: string) => WorkflowInstance | undefined;
  updateGlobalState: (instanceKey: string, value: WorkflowInstance | undefined) => Promise<void>;
  warn: (message: string) => void;
  notifyInstancesChanged: () => void;
  /** 当前活跃实例（列表查询优先返回内存态；磁盘根收集用 taskWorkspacePath/taskDir） */
  active?: {
    key?: string;
    instance?: WorkflowInstance;
  };
  /** purge 命中当前活跃 key 时由引擎清空内存指针与 saveTimer */
  onActivePurged?: (instanceKey: string) => void;
}

export function instanceTaskDirHint(inst?: WorkflowInstance): InstanceTaskDirHint | undefined {
  if (!inst) {
    return undefined;
  }
  return {
    taskDir: inst.taskDir,
    taskWorkspacePath: inst.definition?.meta?.taskWorkspacePath,
  };
}

export function getDefaultTaskDir(ctx: InstanceRepositoryContext, instanceId: string): string {
  const ws = ctx.workspaceFolderPath();
  return getDefaultTaskDirFromPersistence(instanceId, ws, ctx.globalStorageFsPath);
}

export function resolveInitialTaskDirForStart(
  ctx: InstanceRepositoryContext,
  instanceId: string,
  wf: WorkflowDefinition,
): { ok: true; dir: string } | { ok: false; reason: string } {
  const ws = ctx.workspaceFolderPath();
  return resolveInitialTaskDir(instanceId, wf, ws, ctx.globalStorageFsPath);
}
