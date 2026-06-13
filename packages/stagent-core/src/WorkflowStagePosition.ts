import type { StageRuntime, WorkflowInstance } from './WorkflowDefinition';
import { resolveEffectiveEnableDagScheduler } from './EffectiveSettings';
import { findAllReadyStageIndices, syncDagCurrentStageIndex } from './WorkflowDag';

/** 正在占用执行器或等待 HITL 的阶段状态。 */
export const ACTIVE_STAGE_STATUSES: ReadonlySet<StageRuntime['status']> = new Set([
  'running',
  'retrying',
  'paused',
  'waiting-questions',
]);

/** 已终结、不会再被调度的阶段状态。 */
export const COMPLETED_STAGE_STATUSES: ReadonlySet<StageRuntime['status']> = new Set(['done', 'skipped']);

export interface WorkflowStagePosition {
  /** 线性模式：stages[] 游标；DAG 模式：UI/HITL 焦点（由 sync 对齐，见 docs/dag-scheduling.md）。 */
  focusStageIndex: number;
  focusStageId: string | null;
  activeStageIds: string[];
  completedStageIds: string[];
  readyStageIds: string[];
  schedulingMode: 'linear' | 'dag';
}

function stageIdAt(instance: WorkflowInstance, index: number): string | null {
  return instance.definition.stages[index]?.id ?? null;
}

/** 从 stageRuntimes 推导当前 active 阶段 id（可多路并行）。 */
export function deriveActiveStageIds(instance: WorkflowInstance): string[] {
  return instance.stageRuntimes
    .filter((rt) => ACTIVE_STAGE_STATUSES.has(rt.status))
    .map((rt) => rt.stageId);
}

/** 从 stageRuntimes 推导已完成阶段 id。 */
export function deriveCompletedStageIds(instance: WorkflowInstance): string[] {
  return instance.stageRuntimes
    .filter((rt) => COMPLETED_STAGE_STATUSES.has(rt.status))
    .map((rt) => rt.stageId);
}

/** DAG 模式下依赖已满足、仍为 pending/retrying 的阶段 id。 */
export function deriveReadyStageIds(instance: WorkflowInstance): string[] {
  const { stages } = instance.definition;
  const { stageRuntimes } = instance;
  return findAllReadyStageIndices(stages, stageRuntimes).map((i) => stages[i].id);
}

/** 只读计算 UI 焦点 index（不修改 instance）。 */
export function deriveFocusStageIndex(instance: WorkflowInstance): number {
  const clone = {
    ...instance,
    currentStageIndex: instance.currentStageIndex,
    stageRuntimes: instance.stageRuntimes.map((rt) => ({ ...rt })),
  };
  syncDagCurrentStageIndex(clone);
  return clone.currentStageIndex;
}

/** 统一阶段位置视图：推荐 UI / 日志 / 恢复逻辑使用，而非直接读 currentStageIndex。 */
export function describeWorkflowStagePosition(instance: WorkflowInstance): WorkflowStagePosition {
  const dag = resolveEffectiveEnableDagScheduler(instance.definition.globalConfig);
  const focusStageIndex = dag ? deriveFocusStageIndex(instance) : instance.currentStageIndex;
  return {
    focusStageIndex,
    focusStageId: stageIdAt(instance, focusStageIndex),
    activeStageIds: deriveActiveStageIds(instance),
    completedStageIds: deriveCompletedStageIds(instance),
    readyStageIds: dag ? deriveReadyStageIds(instance) : [],
    schedulingMode: dag ? 'dag' : 'linear',
  };
}

/**
 * 持久化恢复 / HITL 返回后对齐实例游标。
 * 线性模式：currentStageIndex 即权威游标；DAG 模式：currentStageIndex 为 focus 缓存，须与本函数同步。
 */
export function syncInstanceStagePosition(instance: WorkflowInstance): void {
  syncDagCurrentStageIndex(instance);
}
