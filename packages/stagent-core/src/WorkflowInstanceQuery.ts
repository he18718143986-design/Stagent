import type { WorkflowInstance } from './WorkflowDefinition';

export function isRecoverableInstance(inst: WorkflowInstance): boolean {
  // idle = 确认页草稿；running = 执行中/HITL 暂停；failed = 失败可继续处理。
  // completed 只读查看走点选任务+文件树，不必 resume。
  return inst.status === 'idle' || inst.status === 'running' || inst.status === 'failed';
}

export function getRecoverableInstanceKeysFromGlobalStateKeys(
  keys: readonly string[],
  loadByKey: (instanceKey: string) => WorkflowInstance | undefined,
): string[] {
  const out: string[] = [];
  for (const key of keys) {
    if (!key.startsWith('wf_instance_')) {
      continue;
    }
    const instanceKey = key.slice('wf_instance_'.length);
    const inst = loadByKey(instanceKey);
    if (!inst) {
      continue;
    }
    if (isRecoverableInstance(inst)) {
      out.push(instanceKey);
    }
  }
  return out;
}

export function getTaskSummariesFromGlobalStateEntries(
  entries: Array<{ key: string; value: unknown }>,
): WorkflowInstance[] {
  const list: WorkflowInstance[] = [];
  for (const { key, value } of entries) {
    if (!key.startsWith('wf_instance_')) {
      continue;
    }
    if (value && typeof value === 'object' && 'definition' in (value as object)) {
      list.push(value as WorkflowInstance);
    }

  }
  return list;
}

/** 侧栏任务列表项：避免传输完整实例数据，仅含展示所需字段。 */
export interface TaskListItem {
  instanceKey: string;
  title: string;
  taskType: string;
  /** idle | running | paused | completed | error */
  status: string;
  /** 是否应显示侧栏「恢复」入口（idle/running/failed）。 */
  recoverable: boolean;
  stageCount: number;
  completedStages: number;
  createdAt: string;
  userInput: string;
  /** 该任务的输出工作目录（meta.taskWorkspacePath）；供 UI 渲染该任务的文件树。 */
  taskWorkspacePath?: string;
}

export const COMPLETED_STAGE_STATUSES = new Set(['done', 'approved', 'skipped']);

export function countCompletedStages(inst: WorkflowInstance): number {
  const runtimes = Array.isArray(inst.stageRuntimes) ? inst.stageRuntimes : [];
  return runtimes.filter((rt) => COMPLETED_STAGE_STATUSES.has(rt.status)).length;
}

/** 将运行时实例映射为轻量任务列表项（含 globalState 实例键，供恢复/删除使用）。 */
export function buildTaskListItem(instanceKey: string, inst: WorkflowInstance): TaskListItem {
  const completedStages = countCompletedStages(inst);
  const stageRuntimes = Array.isArray(inst.stageRuntimes) ? inst.stageRuntimes : [];
  return {
    instanceKey,
    title: inst.definition?.meta?.title ?? inst.definition?.id ?? instanceKey,
    taskType: inst.definition?.meta?.taskType ?? 'auto',
    status: inst.status === 'failed' ? 'error' : (inst.status ?? 'idle'),
    recoverable: isRecoverableInstance(inst),
    stageCount: inst.definition?.stages?.length ?? stageRuntimes.length,
    completedStages,
    createdAt: inst.definition?.meta?.createdAt ?? inst.startedAt ?? '',
    userInput: inst.definition?.meta?.userInput ?? '',
    taskWorkspacePath: inst.definition?.meta?.taskWorkspacePath,
  };
}
