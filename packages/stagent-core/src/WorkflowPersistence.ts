/**
 * 任务目录下 `.wf-state.json` 的读写（M12.3：与引擎 `resumeInstance` 配合；
 * DAG 模式下恢复后的 `currentStageIndex` 对齐由 `WorkflowEngine` 调用 `syncDagCurrentStageIndex` 完成，本模块保持无执行语义）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowInstance } from './WorkflowDefinition';
import { WF_STATE_FILE_NAME } from './WorkflowInstancePersistenceSync';

export interface InstanceTaskDirHint {
  taskDir?: string;
  taskWorkspacePath?: string;
}

export function getDefaultTaskDir(
  instanceId: string,
  workspacePath: string | undefined,
  globalStoragePath: string,
): string {
  if (workspacePath) {
    return path.join(workspacePath, '.stagent', 'instances', instanceId);
  }
  return path.join(globalStoragePath, 'instances', instanceId);
}

/** 解析实例状态目录：优先 instance.taskDir，其次 meta.taskWorkspacePath，最后 VS Code 工作区 / globalStorage。 */
export function resolveInstanceTaskDir(
  instanceKey: string,
  hint: InstanceTaskDirHint | undefined,
  workspaceFolderPath: string | undefined,
  globalStoragePath: string,
): string {
  const taskDir = hint?.taskDir?.trim();
  if (taskDir) {
    return taskDir;
  }
  const taskWorkspacePath = hint?.taskWorkspacePath?.trim();
  if (taskWorkspacePath) {
    return path.join(path.resolve(taskWorkspacePath), '.stagent', 'instances', instanceKey);
  }
  return getDefaultTaskDir(instanceKey, workspaceFolderPath, globalStoragePath);
}

export function instanceDiskStateFileExists(
  instanceKey: string,
  hint: InstanceTaskDirHint | undefined,
  workspaceFolderPath: string | undefined,
  globalStoragePath: string,
): boolean {
  const dir = resolveInstanceTaskDir(instanceKey, hint, workspaceFolderPath, globalStoragePath);
  return fs.existsSync(path.join(dir, WF_STATE_FILE_NAME));
}

export function getStateFilePath(
  instanceKey: string,
  workspacePath: string | undefined,
  globalStoragePath: string,
  taskDir?: string,
): string {
  const dir = taskDir ?? getDefaultTaskDir(instanceKey, workspacePath, globalStoragePath);
  return path.join(dir, WF_STATE_FILE_NAME);
}

export async function persistInstanceFileAsync(
  instanceKey: string,
  instance: WorkflowInstance,
  workspacePath: string | undefined,
  globalStoragePath: string,
): Promise<void> {
  persistInstanceFile(instanceKey, instance, workspacePath, globalStoragePath);
}

export function persistInstanceFile(
  instanceKey: string,
  instance: WorkflowInstance,
  workspacePath: string | undefined,
  globalStoragePath: string,
): void {
  const taskDir = instance.taskDir ?? getDefaultTaskDir(instanceKey, workspacePath, globalStoragePath);
  instance.taskDir = taskDir;
  fs.mkdirSync(taskDir, { recursive: true });
  const statePath = getStateFilePath(instanceKey, workspacePath, globalStoragePath, taskDir);
  fs.writeFileSync(statePath, JSON.stringify(instance, null, 2), 'utf-8');
}

export function readInstanceFile(
  instanceKey: string,
  workspacePath: string | undefined,
  globalStoragePath: string,
  taskDir?: string,
): WorkflowInstance | undefined {
  const statePath = getStateFilePath(instanceKey, workspacePath, globalStoragePath, taskDir);
  if (!fs.existsSync(statePath)) {
    return undefined;
  }
  const raw = fs.readFileSync(statePath, 'utf-8');
  return JSON.parse(raw) as WorkflowInstance;
}
