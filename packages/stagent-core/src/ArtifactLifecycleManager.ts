import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import { listDecisionRetryResetStageIds } from './WorkflowStateTransitions';

export type ArtifactState =
  | 'generated'
  | 'persisted'
  | 'verified'
  | 'approved'
  | 'superseded'
  | 'rolled-back';

export interface ArtifactStateHistoryEntry {
  state: ArtifactState;
  at: string;
  reason?: string;
}

export interface Artifact {
  stageId: string;
  outputKey: string;
  filePath: string;
  state: ArtifactState;
  checksum: string;
  createdAt: string;
  /** 写盘前是否已存在 */
  existedBefore?: boolean;
  /** 写盘前内容（existedBefore 时用于回滚） */
  priorContent?: string;
  stateHistory?: ArtifactStateHistoryEntry[];
}

export interface RollbackResult {
  ok: boolean;
  rolledBack: string[];
  failed: Array<{ filePath: string; error: string }>;
}

export interface PersistedFileTrackInput {
  stageId: string;
  outputKey: string;
  filePath: string;
  content: string;
  existedBefore: boolean;
  priorContent?: string;
}

function checksumContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function pushHistory(artifact: Artifact, state: ArtifactState, reason?: string): void {
  const at = new Date().toISOString();
  artifact.state = state;
  artifact.stateHistory = [...(artifact.stateHistory ?? []), { state, at, reason }];
}

function buildPersistedArtifact(input: PersistedFileTrackInput): Artifact {
  const now = new Date().toISOString();
  return {
    stageId: input.stageId,
    outputKey: input.outputKey,
    filePath: path.normalize(input.filePath),
    state: 'persisted',
    checksum: checksumContent(input.content),
    createdAt: now,
    existedBefore: input.existedBefore,
    priorContent: input.existedBefore ? input.priorContent : undefined,
    stateHistory: [{ state: 'persisted', at: now, reason: 'file-write' }],
  };
}

/** 注册一次落盘；同 stageId+outputKey 的旧条目标记为 superseded */
export function registerPersistedArtifact(registry: Artifact[], input: PersistedFileTrackInput): Artifact {
  for (const existing of registry) {
    if (
      existing.stageId === input.stageId &&
      existing.outputKey === input.outputKey &&
      existing.state !== 'rolled-back' &&
      existing.state !== 'superseded'
    ) {
      pushHistory(existing, 'superseded', `replaced-by-${input.outputKey}`);
    }
  }
  const artifact = buildPersistedArtifact(input);
  registry.push(artifact);
  return artifact;
}

const ROLLBACK_ELIGIBLE: ReadonlySet<ArtifactState> = new Set([
  'persisted',
  'verified',
  'approved',
  'superseded',
]);

function pickArtifactsForPaths(artifacts: Artifact[]): Artifact[] {
  const byPath = new Map<string, Artifact>();
  for (const art of artifacts) {
    const prev = byPath.get(art.filePath);
    if (!prev || art.createdAt >= prev.createdAt) {
      byPath.set(art.filePath, art);
    }
  }
  return [...byPath.values()];
}

export function selectArtifactsForStageIds(registry: Artifact[], resetStageIds: string[]): Artifact[] {
  const ids = new Set(resetStageIds);
  const candidates = registry.filter(
    (a) => ids.has(a.stageId) && ROLLBACK_ELIGIBLE.has(a.state),
  );
  return pickArtifactsForPaths(candidates);
}

function rollbackArtifactOnDisk(artifact: Artifact): { ok: boolean; error?: string } {
  if (artifact.state === 'rolled-back') {
    return { ok: true };
  }
  try {
    if (artifact.existedBefore) {
      fs.mkdirSync(path.dirname(artifact.filePath), { recursive: true });
      fs.writeFileSync(artifact.filePath, artifact.priorContent ?? '', 'utf-8');
    } else if (fs.existsSync(artifact.filePath)) {
      fs.unlinkSync(artifact.filePath);
    }
    pushHistory(artifact, 'rolled-back', 'decision-retry');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 同步回滚（磁盘操作本就是同步的）。 */
export function rollbackArtifactsSync(artifacts: Artifact[]): RollbackResult {
  const rolledBack: string[] = [];
  const failed: Array<{ filePath: string; error: string }> = [];
  for (const art of artifacts) {
    const result = rollbackArtifactOnDisk(art);
    if (result.ok) {
      rolledBack.push(art.filePath);
    } else {
      failed.push({ filePath: art.filePath, error: result.error ?? 'unknown' });
    }
  }
  return { ok: failed.length === 0, rolledBack, failed };
}

export async function rollbackArtifacts(artifacts: Artifact[]): Promise<RollbackResult> {
  return rollbackArtifactsSync(artifacts);
}

/** 同步回滚指定阶段的落盘产物（失败中止路径用，best-effort）。 */
export function rollbackArtifactsForStageSync(registry: Artifact[], stageId: string): RollbackResult {
  const artifacts = selectArtifactsForStageIds(registry, [stageId]);
  if (artifacts.length === 0) {
    return { ok: true, rolledBack: [], failed: [] };
  }
  return rollbackArtifactsSync(artifacts);
}

/**
 * 决策重试时：与 {@link listDecisionRetryResetStageIds} 对齐，选取需回滚的落盘产物。
 */
export class ArtifactLifecycleManager {
  constructor(private readonly registry: Artifact[]) {}

  trackArtifact(artifact: Artifact): void {
    this.registry.push(artifact);
  }

  trackPersistedFile(input: PersistedFileTrackInput): Artifact {
    return registerPersistedArtifact(this.registry, input);
  }

  transition(stageId: string, outputKey: string, newState: ArtifactState, reason?: string): void {
    const art = [...this.registry]
      .reverse()
      .find((a) => a.stageId === stageId && a.outputKey === outputKey && a.state !== 'rolled-back');
    if (art) {
      pushHistory(art, newState, reason);
    }
  }

  getArtifactsForDecisionRetry(
    definition: WorkflowDefinition,
    _instance: WorkflowInstance,
    decisionStageId: string,
    decisionStageIndex: number,
  ): Artifact[] {
    const resetStageIds = listDecisionRetryResetStageIds(definition, decisionStageId, decisionStageIndex);
    return selectArtifactsForStageIds(this.registry, resetStageIds);
  }

  /** 回滚单个阶段的落盘产物（非决策 retry / onError=fail 用）。 */
  async rollbackArtifactsForStage(stageId: string): Promise<RollbackResult> {
    const artifacts = selectArtifactsForStageIds(this.registry, [stageId]);
    if (artifacts.length === 0) {
      return { ok: true, rolledBack: [], failed: [] };
    }
    return rollbackArtifacts(artifacts);
  }

  getArtifactsForStageIds(stageIds: readonly string[]): Artifact[] {
    return selectArtifactsForStageIds(this.registry, [...stageIds]);
  }

  async rollbackArtifacts(artifacts: Artifact[]): Promise<RollbackResult> {
    return rollbackArtifacts(artifacts);
  }
}

/** 阶段暂停审核时：将该阶段 persisted 产物推进为 verified。 */
export function markArtifactsVerifiedForStage(registry: Artifact[], stageId: string): void {
  const mgr = new ArtifactLifecycleManager(registry);
  for (const art of registry) {
    if (art.stageId === stageId && art.state === 'persisted') {
      mgr.transition(stageId, art.outputKey, 'verified', 'pause-review');
    }
  }
}

/** 人工批准阶段时：将该阶段 persisted/verified 产物推进为 approved。 */
export function markArtifactsApprovedForStage(registry: Artifact[], stageId: string): void {
  const mgr = new ArtifactLifecycleManager(registry);
  for (const art of registry) {
    if (art.stageId === stageId && (art.state === 'persisted' || art.state === 'verified')) {
      mgr.transition(stageId, art.outputKey, 'approved', 'human-approve');
    }
  }
}

export async function readPriorFileContentAsync(
  filePath: string,
): Promise<{ existedBefore: boolean; priorContent?: string }> {
  return readPriorFileContent(filePath);
}

export function readPriorFileContent(filePath: string): { existedBefore: boolean; priorContent?: string } {
  if (!fs.existsSync(filePath)) {
    return { existedBefore: false };
  }
  return { existedBefore: true, priorContent: fs.readFileSync(filePath, 'utf-8') };
}
