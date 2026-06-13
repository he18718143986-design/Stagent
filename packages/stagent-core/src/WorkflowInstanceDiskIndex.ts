import * as fs from 'fs';
import * as path from 'path';
import { instancesRootUnderWorkspace } from './paths/StagentPaths';
import type { WorkflowInstance } from './WorkflowDefinition';
import { WF_STATE_FILE_NAME } from './WorkflowInstancePersistenceSync';

/** 列举 `…/instances/<id>/.wf-state.json` 存在的实例 id。 */
export function listInstanceKeysUnderRoot(instancesRoot: string): string[] {
  if (!fs.existsSync(instancesRoot)) {
    return [];
  }
  const out: string[] = [];
  for (const ent of fs.readdirSync(instancesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) {
      continue;
    }
    const statePath = path.join(instancesRoot, ent.name, WF_STATE_FILE_NAME);
    if (fs.existsSync(statePath)) {
      out.push(ent.name);
    }
  }
  return out;
}

export function readInstanceStateFile(statePath: string): WorkflowInstance | undefined {
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as WorkflowInstance;
  } catch {
    return undefined;
  }
}

export function readInstanceFromDiskRoots(
  instanceKey: string,
  roots: readonly string[],
): WorkflowInstance | undefined {
  for (const root of roots) {
    const statePath = path.join(root, instanceKey, WF_STATE_FILE_NAME);
    if (!fs.existsSync(statePath)) {
      continue;
    }
    const inst = readInstanceStateFile(statePath);
    if (inst) {
      return inst;
    }
  }
  return undefined;
}

export function collectInstanceKeysFromDiskRoots(roots: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const root of roots) {
    for (const k of listInstanceKeysUnderRoot(root)) {
      keys.add(k);
    }
  }
  return [...keys];
}

import { DEFAULT_WORKSPACE_SKIP_DIR_NAMES as DEFAULT_SKIP_DIR_NAMES } from './workspace/WorkspaceSkipDirs';

/**
 * 在目录树下查找 `…/.stagent/instances`（如 `stagent_vscode/task/05/.stagent/instances`）。
 */
export function discoverInstanceRootsUnderDir(
  workspaceRoot: string,
  maxDepth = 6,
  skipDirNames: ReadonlySet<string> = DEFAULT_SKIP_DIR_NAMES,
): string[] {
  const roots = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) {
      return;
    }
    const instancesHere = instancesRootUnderWorkspace(dir);
    if (fs.existsSync(instancesHere)) {
      roots.add(instancesHere);
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || skipDirNames.has(ent.name)) {
        continue;
      }
      walk(path.join(dir, ent.name), depth + 1);
    }
  };
  if (fs.existsSync(workspaceRoot)) {
    walk(workspaceRoot, 0);
  }
  return [...roots];
}
