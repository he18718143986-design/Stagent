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
