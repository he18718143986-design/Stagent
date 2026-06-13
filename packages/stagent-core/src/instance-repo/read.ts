/**
 * 实例读取 / 加载路径（从 WorkflowInstanceRepository.ts 抽出，1.3）。
 */
import type { WorkflowInstance } from '../WorkflowDefinition';
import { voidGlobalStateUpdate } from '../instance/GlobalStateSafeUpdate';
import {
  instanceDiskStateFileExists,
  readInstanceFile as readInstanceFileFromDisk,
  resolveInstanceTaskDir,
  type InstanceTaskDirHint,
} from '../WorkflowPersistence';
import { readInstanceFromDiskRoots } from '../WorkflowInstanceDiskIndex';
import {
  resolveInstanceForTaskList,
  resolveInstanceLoadSync,
} from '../WorkflowInstancePersistenceSync';
import { instanceTaskDirHint, type InstanceRepositoryContext } from './context';
import { collectInstanceDiskRoots } from './diskRoots';
import { purgeInstanceGlobalState } from './purge';

/** 任务列表路径：每 instanceKey 每进程最多 warn 一次「仅 globalState、磁盘未写出」。 */
const diskPendingWarnedKeys = new Set<string>();

export function readInstanceFile(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
  taskDir?: string,
): WorkflowInstance | undefined {
  try {
    const ws = ctx.workspaceFolderPath();
    return readInstanceFileFromDisk(instanceKey, ws, ctx.globalStorageFsPath, taskDir);
  } catch (e) {
    ctx.warn(`state_file_read_failed key=${instanceKey} err=${String(e)}`);
    return undefined;
  }
}

export function isInstanceDiskStatePresent(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
  hint?: InstanceTaskDirHint,
): boolean {
  return instanceDiskStateFileExists(
    instanceKey,
    hint,
    ctx.workspaceFolderPath(),
    ctx.globalStorageFsPath,
  );
}

function readInstanceFromDiskScan(ctx: InstanceRepositoryContext, instanceKey: string): WorkflowInstance | undefined {
  return readInstanceFromDiskRoots(instanceKey, collectInstanceDiskRoots(ctx));
}

function readInstanceFileForHint(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
  hint?: InstanceTaskDirHint,
): WorkflowInstance | undefined {
  const taskDir = resolveInstanceTaskDir(
    instanceKey,
    hint,
    ctx.workspaceFolderPath(),
    ctx.globalStorageFsPath,
  );
  return readInstanceFile(ctx, instanceKey, taskDir);
}

export function loadInstanceByKey(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
): WorkflowInstance | undefined {
  const gs = ctx.getGlobalStateInstance(instanceKey);
  const hint = instanceTaskDirHint(gs);
  const diskStateFileExists = isInstanceDiskStatePresent(ctx, instanceKey, hint);
  const file = diskStateFileExists ? readInstanceFileForHint(ctx, instanceKey, hint) : undefined;
  const outcome = resolveInstanceLoadSync({
    globalStateInstance: gs,
    diskInstance: file,
    diskStateFileExists,
  });

  if (outcome.kind === 'purge_global') {
    purgeInstanceGlobalState(ctx, instanceKey, outcome.reason);
    return undefined;
  }
  if (outcome.kind === 'absent') {
    return undefined;
  }
  if (outcome.promoteToGlobalState) {
    voidGlobalStateUpdate(
      () => ctx.updateGlobalState(instanceKey, outcome.instance),
      ctx.warn,
      `promote_${instanceKey}`,
    );
  }
  return outcome.instance;
}

/** 任务列表 / 摘要：不 purge；优先 globalState，并合并磁盘扫描。 */
export function loadInstanceByKeyForList(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
): WorkflowInstance | undefined {
  const gs = ctx.getGlobalStateInstance(instanceKey);
  const hint = instanceTaskDirHint(gs);
  const diskStateFileExists = isInstanceDiskStatePresent(ctx, instanceKey, hint);
  let file = diskStateFileExists ? readInstanceFileForHint(ctx, instanceKey, hint) : undefined;
  if (!file) {
    file = readInstanceFromDiskScan(ctx, instanceKey);
  }
  const outcome = resolveInstanceForTaskList({ globalStateInstance: gs, diskInstance: file });
  if (gs && !diskStateFileExists && !diskPendingWarnedKeys.has(instanceKey)) {
    diskPendingWarnedKeys.add(instanceKey);
    ctx.warn(`instance_list_disk_pending key=${instanceKey}`);
  }
  if (!outcome.instance) {
    return undefined;
  }
  if (outcome.promoteToGlobalState) {
    voidGlobalStateUpdate(
      () => ctx.updateGlobalState(instanceKey, outcome.instance),
      ctx.warn,
      `list_promote_${instanceKey}`,
    );
  }
  return outcome.instance;
}

export function resolveInstanceForList(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
): WorkflowInstance | undefined {
  if (ctx.active?.key === instanceKey && ctx.active.instance) {
    return ctx.active.instance;
  }
  return loadInstanceByKeyForList(ctx, instanceKey);
}
