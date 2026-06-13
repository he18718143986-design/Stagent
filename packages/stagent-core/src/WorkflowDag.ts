import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';

/** 调度用：stage-output 的 stageId ∪ dependsOn（去重）。 */
export function getStageDependencyIds(stage: Stage): string[] {
  const refs = (stage.input?.sources ?? [])
    .filter((s) => s.type === 'stage-output' && typeof s.stageId === 'string')
    .map((s) => s.stageId as string);
  const explicit = (stage.dependsOn ?? []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return Array.from(new Set([...refs, ...explicit]));
}

function isStageDependencyReady(stages: Stage[], runtimes: StageRuntime[], stageIndex: number): boolean {
  const deps = getStageDependencyIds(stages[stageIndex]);
  return deps.every((depId) => {
    const depIdx = stages.findIndex((s) => s.id === depId);
    if (depIdx < 0) {
      return false;
    }
    return runtimes[depIdx].status === 'done' || runtimes[depIdx].status === 'skipped';
  });
}

function isStageRunnableStatus(status: StageRuntime['status']): boolean {
  return status === 'pending' || status === 'retrying';
}

/** 阶段是否可与其他 ready 阶段同批并行（决策 / pauseAfter / questionBefore 须串行）。 */
export function stageEligibleForDagParallelism(stage: Stage): boolean {
  if (stage.isDecisionStage === true) {
    return false;
  }
  if (stage.pauseAfter) {
    return false;
  }
  if (stage.questionBefore?.length) {
    return false;
  }
  return true;
}

export function findAllReadyStageIndices(stages: Stage[], runtimes: StageRuntime[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < stages.length; i++) {
    if (!isStageRunnableStatus(runtimes[i].status)) {
      continue;
    }
    if (isStageDependencyReady(stages, runtimes, i)) {
      out.push(i);
    }
  }
  return out;
}

export function findNextReadyStageIndex(stages: Stage[], runtimes: StageRuntime[]): number {
  const ready = findAllReadyStageIndices(stages, runtimes);
  return ready.length > 0 ? ready[0] : -1;
}

/** workflow / vscode 默认 1（单线程，兼容 M12）；≥2 启用 DAG 并行波次。 */
export function resolveDagMaxParallelism(
  workflowValue: number | undefined,
  vscodeDefault: number,
): number {
  if (typeof workflowValue === 'number' && Number.isFinite(workflowValue) && workflowValue >= 1) {
    return Math.floor(workflowValue);
  }
  if (Number.isFinite(vscodeDefault) && vscodeDefault >= 1) {
    return Math.floor(vscodeDefault);
  }
  return 1;
}

/**
 * 从 ready 索引中选出本波应执行的批次：有须串行阶段时只取第一个；否则取至多 maxParallel 个可并行阶段。
 */
export function pickDagExecutionBatch(
  stages: Stage[],
  runtimes: StageRuntime[],
  maxParallel: number,
): number[] {
  const ready = findAllReadyStageIndices(stages, runtimes);
  if (ready.length === 0) {
    return [];
  }
  const serial = ready.filter((i) => !stageEligibleForDagParallelism(stages[i]));
  if (serial.length > 0) {
    return [serial[0]];
  }
  const cap = Math.max(1, maxParallel);
  return ready.slice(0, cap);
}

/** 若依赖图（边：dep → consumer）存在环，返回错误文案；否则 null。 */
export function formatWorkflowDependencyCycleError(stages: Stage[]): string | null {
  const ids = stages.map((s) => s.id);
  const idSet = new Set(ids);
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const s of stages) {
    const sid = s.id;
    for (const d of getStageDependencyIds(s)) {
      if (!idSet.has(d) || d === sid) {
        continue;
      }
      indegree.set(sid, (indegree.get(sid) ?? 0) + 1);
      adj.get(d)!.push(sid);
    }
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  let processed = 0;
  while (queue.length) {
    const u = queue.shift()!;
    processed++;
    for (const v of adj.get(u) ?? []) {
      indegree.set(v, (indegree.get(v) ?? 0) - 1);
      if ((indegree.get(v) ?? 0) === 0) {
        queue.push(v);
      }
    }
  }
  if (processed === ids.length) {
    return null;
  }
  const stuck = ids.filter((id) => (indegree.get(id) ?? 0) > 0);
  return `阶段依赖图存在环或无法满足的依赖（参与节点示例：${stuck.slice(0, 8).join(', ')}${stuck.length > 8 ? '…' : ''}）；请检查 dependsOn 与 stage-output`;
}

/**
 * 从 sourceStageId 出发，沿「谁依赖我」正向闭包，收集所有传递性下游阶段 id（不含源阶段自身）。
 */
export function collectTransitiveConsumerStageIds(definition: WorkflowDefinition, sourceStageId: string): string[] {
  const out = new Set<string>();
  const queue = [sourceStageId];
  while (queue.length) {
    const n = queue.shift()!;
    for (const s of definition.stages) {
      if (s.id === n) {
        continue;
      }
      const deps = getStageDependencyIds(s);
      if (deps.includes(n) && !out.has(s.id)) {
        out.add(s.id);
        queue.push(s.id);
      }
    }
  }
  return Array.from(out);
}

/**
 * 从 stages[0] 沿「dep → consumer」正向可达闭包；不可达 id 常用于 DAG 下孤立子图提示（warning）。
 */
export function findStageIdsUnreachableFromFirstStage(stages: Stage[]): string[] {
  if (stages.length === 0) {
    return [];
  }
  const start = stages[0].id;
  const ids = stages.map((s) => s.id);
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    adj.set(id, []);
  }
  for (const s of stages) {
    for (const d of getStageDependencyIds(s)) {
      if (!idSet.has(d)) {
        continue;
      }
      adj.get(d)!.push(s.id);
    }
  }
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const u = queue.shift()!;
    if (seen.has(u)) {
      continue;
    }
    seen.add(u);
    for (const v of adj.get(u) ?? []) {
      if (!seen.has(v)) {
        queue.push(v);
      }
    }
  }
  return ids.filter((id) => !seen.has(id));
}

/**
 * M12.3：DAG 模式下恢复/持久化后，将 currentStageIndex 对齐到「当前应对用户展示或可继续执行」的阶段，
 * 避免仅线性推进时遗留的游标与真实 paused/ready 不一致。
 */
export function syncDagCurrentStageIndex(instance: WorkflowInstance): void {
  if (instance.definition.globalConfig?.enableDagScheduler !== true) {
    return;
  }
  const { stages } = instance.definition;
  const { stageRuntimes } = instance;

  const pausedIdx = stageRuntimes.findIndex((rt) => rt.status === 'paused' || rt.status === 'waiting-questions');
  if (pausedIdx >= 0) {
    instance.currentStageIndex = pausedIdx;
    return;
  }

  const runningIndices = stageRuntimes
    .map((rt, i) => (rt.status === 'running' || rt.status === 'retrying' ? i : -1))
    .filter((i) => i >= 0);
  if (runningIndices.length > 0) {
    instance.currentStageIndex = Math.min(...runningIndices);
    return;
  }

  const nextIdx = findNextReadyStageIndex(stages, stageRuntimes);
  if (nextIdx >= 0) {
    instance.currentStageIndex = nextIdx;
    return;
  }

  const allTerminal = stageRuntimes.every((rt) => rt.status === 'done' || rt.status === 'skipped');
  if (allTerminal) {
    instance.currentStageIndex = Math.max(0, stages.length - 1);
    return;
  }

  const pendIdx = stageRuntimes.findIndex((rt) => rt.status === 'pending');
  if (pendIdx >= 0) {
    instance.currentStageIndex = pendIdx;
  }
}

/** #11：恢复后游标与 ready/paused 摘要（单测与调试）。 */
export function describeDagRecoveryCursor(instance: WorkflowInstance): {
  mode: 'linear' | 'dag';
  currentStageIndex: number;
  currentStageId: string | undefined;
  readyIndices: number[];
  pausedIndices: number[];
} {
  const stages = instance.definition.stages;
  const stageRuntimes = instance.stageRuntimes;
  const mode = instance.definition.globalConfig?.enableDagScheduler === true ? 'dag' : 'linear';
  const pausedIndices: number[] = [];
  for (let i = 0; i < stageRuntimes.length; i++) {
    const rt = stageRuntimes[i];
    if (rt.status === 'paused' || rt.status === 'waiting-questions') {
      pausedIndices.push(i);
    }
  }
  const readyIndices =
    mode === 'dag' ? findAllReadyStageIndices(stages, stageRuntimes) : [];
  const idx = instance.currentStageIndex;
  return {
    mode,
    currentStageIndex: idx,
    currentStageId: stages[idx]?.id,
    readyIndices,
    pausedIndices,
  };
}

/**
 * 从 targetStageId 出发，沿「我依赖谁」反向闭包，收集所有传递性上游阶段 id（不含目标自身）。
 */
export function collectTransitiveDependencyStageIds(
  definition: WorkflowDefinition,
  targetStageId: string,
): string[] {
  const out = new Set<string>();
  const queue = [targetStageId];
  while (queue.length) {
    const n = queue.shift()!;
    const stage = definition.stages.find((s) => s.id === n);
    if (!stage) {
      continue;
    }
    for (const depId of getStageDependencyIds(stage)) {
      if (depId !== targetStageId && !out.has(depId)) {
        out.add(depId);
        queue.push(depId);
      }
    }
  }
  return Array.from(out);
}
