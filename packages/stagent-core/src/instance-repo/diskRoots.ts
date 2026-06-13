/**
 * 实例磁盘根发现与已知 key 枚举（从 WorkflowInstanceRepository.ts 抽出，1.3）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseInstanceKeyFromGlobalStateKey } from '../instance/InstanceGlobalStateKeys';
import {
  collectInstanceKeysFromDiskRoots,
  discoverInstanceRootsUnderDir,
} from '../WorkflowInstanceDiskIndex';
import { readInstanceIndex } from '../WorkflowInstanceIndex';
import {
  INSTANCES_SUBDIR,
  instancesRootUnderGlobalStorage,
  instancesRootUnderWorkspace,
  STAGENT_DIR,
  TASK_SUBDIR,
} from '../paths/StagentPaths';
import { expandUserHomePath } from '../WorkflowPathResolver';
import type { InstanceRepositoryContext } from './context';

function addDiscoveredInstanceRoots(roots: Set<string>, ...parentDirs: string[]): void {
  for (const dir of parentDirs) {
    if (!dir || !fs.existsSync(dir)) {
      continue;
    }
    for (const r of discoverInstanceRootsUnderDir(dir)) {
      roots.add(r);
    }
  }
}

export function collectInstanceDiskRoots(ctx: InstanceRepositoryContext): string[] {
  const roots = new Set<string>();
  const ws = ctx.workspaceFolderPath();
  const globalRoot = instancesRootUnderGlobalStorage(ctx.globalStorageFsPath);
  if (ws) {
    roots.add(instancesRootUnderWorkspace(ws));
    addDiscoveredInstanceRoots(roots, ws, path.join(ws, TASK_SUBDIR));
  }
  addDiscoveredInstanceRoots(roots, path.join(ctx.extensionDir, TASK_SUBDIR));
  roots.add(globalRoot);
  for (const key of ctx.globalStateKeys()) {
    const instanceKeyFromGs = parseInstanceKeyFromGlobalStateKey(key);
    if (!instanceKeyFromGs) {
      continue;
    }
    const gs = ctx.getGlobalStateInstance(instanceKeyFromGs);
    const twp = gs?.definition?.meta?.taskWorkspacePath?.trim();
    if (twp) {
      roots.add(instancesRootUnderWorkspace(path.resolve(expandUserHomePath(twp))));
    }
    const td = gs?.taskDir?.trim();
    if (td) {
      const parent = path.dirname(td);
      if (
        parent.endsWith(`${path.sep}${INSTANCES_SUBDIR}`) ||
        parent.includes(`${path.sep}${STAGENT_DIR}${path.sep}${INSTANCES_SUBDIR}`)
      ) {
        roots.add(parent);
      }
    }
  }
  const active = ctx.active?.instance;
  if (active?.definition?.meta?.taskWorkspacePath?.trim()) {
    const twp = path.resolve(expandUserHomePath(active.definition.meta.taskWorkspacePath.trim()));
    roots.add(instancesRootUnderWorkspace(twp));
  }
  if (active?.taskDir?.trim()) {
    roots.add(path.dirname(active.taskDir.trim()));
  }
  return [...roots];
}

export function listKnownInstanceKeys(ctx: InstanceRepositoryContext): string[] {
  const keys = new Set<string>();
  if (ctx.active?.key) {
    keys.add(ctx.active.key);
  }
  for (const key of ctx.globalStateKeys()) {
    const ik = parseInstanceKeyFromGlobalStateKey(key);
    if (ik) {
      keys.add(ik);
    }
  }
  const indexed = readInstanceIndex(ctx.workspaceFolderPath());
  if (indexed.length > 0) {
    for (const e of indexed) {
      keys.add(e.instanceKey);
    }
  } else {
    for (const k of collectInstanceKeysFromDiskRoots(collectInstanceDiskRoots(ctx))) {
      keys.add(k);
    }
  }
  return [...keys];
}
