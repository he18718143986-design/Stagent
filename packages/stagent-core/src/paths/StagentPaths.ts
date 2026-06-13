/**
 * Stagent 工作区 / globalStorage 磁盘布局路径（单点定义，避免散落 `.stagent` 字面量）。
 */
import * as path from 'path';

export const STAGENT_DIR = '.stagent';
export const INSTANCES_SUBDIR = 'instances';
export const CONTEXT_MD_FILENAME = 'CONTEXT.md';
export const GENERATED_SUBDIR = 'generated';
export const PROMPT_VERSIONS_FILENAME = 'prompt-versions.json';
export const GLOBAL_FAILURE_LOGS_DIR = 'failure-logs';
export const ADR_SUBDIR = 'adr';
export const MODULE_MAP_FILENAME = 'module-map.md';
export const WF_STATE_FILE_NAME = '.wf-state.json';
export const EXPERIENCES_FILENAME = 'experiences.jsonl';
export const INSTANCE_INDEX_FILE = 'index.json';
export const WF_FAILURES_FILENAME = '.wf-failures.jsonl';
export const GLOBAL_FAILURES_FILENAME = 'failures.jsonl';
export const SESSION_DEBUG_FILENAME = '.session-debug.log';
export const WF_DEBUG_FILENAME = '.wf-debug.log';
export const TASK_SUBDIR = 'task';

export const STAGENT_ADR_DIR = `${STAGENT_DIR}/${ADR_SUBDIR}`;

export function stagentDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, STAGENT_DIR);
}

export function taskInstanceDir(workspaceRoot: string, instanceId: string): string {
  return path.join(stagentDir(workspaceRoot), INSTANCES_SUBDIR, instanceId);
}

export function contextMdPath(workspaceRoot: string): string {
  return path.join(stagentDir(workspaceRoot), CONTEXT_MD_FILENAME);
}

export function promptVersionsPath(workspaceRoot: string): string {
  return path.join(stagentDir(workspaceRoot), PROMPT_VERSIONS_FILENAME);
}

export function experiencesPath(workspaceRoot: string, experiencesFilename: string): string {
  return path.join(stagentDir(workspaceRoot), experiencesFilename);
}

export function generatedArtifactRelativePath(stageId: string): string {
  return path.join(STAGENT_DIR, GENERATED_SUBDIR, `${stageId}.md`).replace(/\\/g, '/');
}

export function moduleMapRelativePath(): string {
  return path.join(STAGENT_DIR, MODULE_MAP_FILENAME).replace(/\\/g, '/');
}

export function instancesRootUnderGlobalStorage(globalStoragePath: string): string {
  return path.join(globalStoragePath, INSTANCES_SUBDIR);
}

export function globalStorageInstanceDir(globalStoragePath: string, instanceId: string): string {
  return path.join(instancesRootUnderGlobalStorage(globalStoragePath), instanceId);
}

export function instancesRootUnderWorkspace(workspaceRoot: string): string {
  return path.join(stagentDir(workspaceRoot), INSTANCES_SUBDIR);
}

export function globalFailureLogsDir(globalStoragePath: string): string {
  return path.join(globalStoragePath, GLOBAL_FAILURE_LOGS_DIR);
}

export function adrDir(workspaceRoot: string): string {
  return path.join(stagentDir(workspaceRoot), ADR_SUBDIR);
}

export function taskDebugLogPath(taskDir: string): string {
  return path.join(taskDir, WF_DEBUG_FILENAME);
}
