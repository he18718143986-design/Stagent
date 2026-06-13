import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteTextFileSync } from './FsAsync';
import { stagentDir, INSTANCE_INDEX_FILE } from './paths/StagentPaths';
import { WORKFLOW_META_TITLE_MAX } from './LogPreviewLimits';
import type { WorkflowInstance } from './WorkflowDefinition';

export { INSTANCE_INDEX_FILE } from './paths/StagentPaths';

export interface InstanceIndexEntry {
  instanceKey: string;
  taskDir: string;
  title: string;
  updatedAt: string;
  status: string;
}

export interface InstanceIndexFile {
  version: 1;
  entries: InstanceIndexEntry[];
}

function indexPathForWorkspace(workspaceRoot: string): string {
  return path.join(stagentDir(workspaceRoot), INSTANCE_INDEX_FILE);
}

export function readInstanceIndex(workspaceRoot: string | undefined): InstanceIndexEntry[] {
  if (!workspaceRoot) {
    return [];
  }
  const filePath = indexPathForWorkspace(workspaceRoot);
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as InstanceIndexFile;
    if (raw?.version !== 1 || !Array.isArray(raw.entries)) {
      return [];
    }
    return raw.entries;
  } catch {
    return [];
  }
}

export function upsertInstanceIndexEntry(
  workspaceRoot: string | undefined,
  entry: InstanceIndexEntry,
): void {
  if (!workspaceRoot) {
    return;
  }
  const dir = stagentDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = indexPathForWorkspace(workspaceRoot);
  const existing = readInstanceIndex(workspaceRoot).filter((e) => e.instanceKey !== entry.instanceKey);
  existing.push(entry);
  existing.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const payload: InstanceIndexFile = { version: 1, entries: existing };
  atomicWriteTextFileSync(filePath, JSON.stringify(payload, null, 2));
}

export function removeInstanceIndexEntry(workspaceRoot: string | undefined, instanceKey: string): void {
  if (!workspaceRoot) {
    return;
  }
  const filePath = indexPathForWorkspace(workspaceRoot);
  const next = readInstanceIndex(workspaceRoot).filter((e) => e.instanceKey !== instanceKey);
  if (next.length === 0) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  atomicWriteTextFileSync(
    filePath,
    JSON.stringify({ version: 1, entries: next } satisfies InstanceIndexFile, null, 2),
  );
}

export function instanceIndexEntryFromWorkflow(
  instanceKey: string,
  inst: WorkflowInstance,
): InstanceIndexEntry {
  return {
    instanceKey,
    taskDir: inst.taskDir ?? '',
    title:
      inst.definition.meta.title ||
      inst.definition.meta.userInput.slice(0, WORKFLOW_META_TITLE_MAX) ||
      instanceKey,
    updatedAt:
      inst.completedAt ??
      inst.startedAt ??
      inst.definition.meta.createdAt ??
      new Date().toISOString(),
    status: inst.status,
  };
}
