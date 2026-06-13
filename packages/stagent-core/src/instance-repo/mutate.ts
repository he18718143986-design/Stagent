/**
 * 实例写入 / 删除 / 复用与陈旧 globalState 清理（从 WorkflowInstanceRepository.ts 抽出，1.3）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { parseInstanceKeyFromGlobalStateKey } from '../instance/InstanceGlobalStateKeys';
import { buildDeletionTargets, type DeleteScope } from '../WorkflowDeletePlan';
import {
  persistInstanceFile,
  resolveInstanceTaskDir,
} from '../WorkflowPersistence';
import { removeInstanceIndexEntry } from '../WorkflowInstanceIndex';
import { WF_STATE_FILE_NAME } from '../WorkflowInstancePersistenceSync';
import { isStagentInstanceStateDir } from '../paths/StagentInstancePathGuards';
import { instanceTaskDirHint, type InstanceRepositoryContext } from './context';
import { isInstanceDiskStatePresent, loadInstanceByKey } from './read';
import { purgeInstanceGlobalState } from './purge';

/** 激活时扫描：磁盘缺失时尽量从 globalState 回写；仅当状态目录也不存在时才 purge。 */
export function pruneStaleGlobalInstances(ctx: InstanceRepositoryContext): void {
  for (const key of ctx.globalStateKeys()) {
    const instanceKey = parseInstanceKeyFromGlobalStateKey(key);
    if (!instanceKey) {
      continue;
    }
    const gs = ctx.getGlobalStateInstance(instanceKey);
    if (!gs) {
      continue;
    }
    const hint = instanceTaskDirHint(gs);
    if (isInstanceDiskStatePresent(ctx, instanceKey, hint)) {
      continue;
    }
    const taskDir = resolveInstanceTaskDir(
      instanceKey,
      hint,
      ctx.workspaceFolderPath(),
      ctx.globalStorageFsPath,
    );
    if (fs.existsSync(taskDir)) {
      try {
        persistInstanceFile(
          instanceKey,
          gs,
          ctx.workspaceFolderPath(),
          ctx.globalStorageFsPath,
        );
        ctx.warn(`instance_disk_recovered_from_global_state key=${instanceKey}`);
        continue;
      } catch (e) {
        ctx.warn(`instance_disk_recover_failed key=${instanceKey} err=${String(e)}`);
      }
    }
    if (!fs.existsSync(path.join(taskDir, WF_STATE_FILE_NAME))) {
      purgeInstanceGlobalState(ctx, instanceKey, 'disk_state_missing');
    }
  }
  ctx.notifyInstancesChanged();
}

export interface DeleteInstanceResult {
  /** 被删 key 是否为当前活跃实例（调用方应清空 engine 指针） */
  clearedActive: boolean;
}

/**
 * 删除任务，按力度三档：record / artifacts / folder（见 WorkflowDeletePlan）。
 */
export function deleteInstanceRecord(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
  scope: DeleteScope = 'record',
): DeleteInstanceResult {
  const inst =
    loadInstanceByKey(ctx, instanceKey) ?? ctx.getGlobalStateInstance(instanceKey);

  if (scope !== 'record') {
    const targets = buildDeletionTargets(inst, scope, { homeDir: os.homedir() });
    for (const r of targets.rejected) {
      ctx.warn(`delete_instance_target_rejected key=${instanceKey} reason=${r.reason} path=${r.path}`);
    }
    for (const f of targets.files) {
      try {
        fs.rmSync(f, { force: true });
      } catch (e) {
        ctx.warn(`delete_instance_artifact_rm_failed key=${instanceKey} path=${f} err=${String(e)}`);
      }
    }
    for (const d of targets.dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch (e) {
        ctx.warn(`delete_instance_folder_rm_failed key=${instanceKey} path=${d} err=${String(e)}`);
      }
    }
  }

  let stateDir: string | undefined;
  try {
    stateDir = resolveInstanceTaskDir(
      instanceKey,
      instanceTaskDirHint(inst),
      ctx.workspaceFolderPath(),
      ctx.globalStorageFsPath,
    );
  } catch (e) {
    ctx.warn(`delete_instance_resolve_dir_failed key=${instanceKey} err=${String(e)}`);
  }
  purgeInstanceGlobalState(ctx, instanceKey, 'user_delete');
  removeInstanceIndexEntry(ctx.workspaceFolderPath(), instanceKey);
  if (stateDir && isStagentInstanceStateDir(stateDir)) {
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch (e) {
      ctx.warn(`delete_instance_rm_failed key=${instanceKey} err=${String(e)}`);
    }
  }
  const clearedActive = ctx.active?.key === instanceKey;
  ctx.notifyInstancesChanged();
  return { clearedActive };
}

export function resolveReuseInstance(
  ctx: InstanceRepositoryContext,
  instanceKey: string | undefined,
  activeKey: string | undefined,
  activeInstance: WorkflowInstance | undefined,
): {
  reuse: boolean;
  existing?: WorkflowInstance;
  instanceId: string;
} {
  if (!instanceKey) {
    return { reuse: false, instanceId: crypto.randomUUID() };
  }
  const existing =
    activeKey === instanceKey && activeInstance
      ? activeInstance
      : loadInstanceByKey(ctx, instanceKey);
  const reusable =
    existing?.status === 'idle' ||
    existing?.status === 'failed' ||
    existing?.status === 'completed';
  const reuse = !!existing && reusable && !!existing.taskDir;
  return {
    reuse,
    existing: reuse ? existing : undefined,
    instanceId: reuse ? instanceKey : crypto.randomUUID(),
  };
}
