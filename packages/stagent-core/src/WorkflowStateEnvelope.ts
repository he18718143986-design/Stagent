import * as crypto from 'crypto';
import { CONTENT_HASH_HEX_PREFIX_CHARS } from './LogPreviewLimits';
import type { WorkflowInstance } from './WorkflowDefinition';

export const WF_STATE_SCHEMA_VERSION = 1;

export interface WorkflowStateEnvelope {
  schemaVersion: number;
  contentHash?: string;
  instance: WorkflowInstance;
}

function stableInstancePayload(instance: WorkflowInstance): string {
  return JSON.stringify({
    id: instance.definition?.id,
    status: instance.status,
    currentStageIndex: instance.currentStageIndex,
    stageRuntimes: instance.stageRuntimes,
    traceId: instance.traceId,
    taskDir: instance.taskDir,
    artifactRegistry: instance.artifactRegistry,
  });
}

/** 取实例持久化世代号（缺省视为 0，兼容旧状态文件）。 */
export function instancePersistRevision(instance: WorkflowInstance | undefined): number {
  const rev = instance?.persistRevision;
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0;
}

/**
 * 落盘前自增世代号并打时间戳；磁盘与 globalState 共享同一实例引用，
 * 因此两个存储会写入相同的 persistRevision，供加载时对账。
 */
export function bumpInstancePersistRevision(instance: WorkflowInstance): void {
  instance.persistRevision = instancePersistRevision(instance) + 1;
  instance.lastSavedAt = new Date().toISOString();
}

export function computeInstanceContentHash(instance: WorkflowInstance): string {
  return crypto
    .createHash('sha256')
    .update(stableInstancePayload(instance), 'utf8')
    .digest('hex')
    .slice(0, CONTENT_HASH_HEX_PREFIX_CHARS);
}

export function wrapInstanceForDisk(instance: WorkflowInstance): WorkflowStateEnvelope {
  const envelope: WorkflowStateEnvelope = {
    schemaVersion: WF_STATE_SCHEMA_VERSION,
    instance,
  };
  envelope.contentHash = computeInstanceContentHash(instance);
  return envelope;
}

export function unwrapInstanceFromDisk(
  parsed: unknown,
  warn?: (message: string) => void,
): WorkflowInstance | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const o = parsed as Record<string, unknown>;
  if (o.definition && o.stageRuntimes && o.schemaVersion === undefined) {
    return parsed as WorkflowInstance;
  }
  if (typeof o.schemaVersion === 'number' && o.instance && typeof o.instance === 'object') {
    const inst = o.instance as WorkflowInstance;
    if (typeof o.contentHash === 'string' && o.contentHash.length > 0) {
      const expected = computeInstanceContentHash(inst);
      if (o.contentHash !== expected) {
        warn?.(`state_content_hash_mismatch expected=${expected} got=${o.contentHash}`);
      }
    }
    if (o.schemaVersion > WF_STATE_SCHEMA_VERSION) {
      warn?.(`state_schema_newer_than_engine file=${o.schemaVersion} engine=${WF_STATE_SCHEMA_VERSION}`);
    }
    return inst;
  }
  return undefined;
}

export function serializeInstanceForDisk(instance: WorkflowInstance): string {
  return JSON.stringify(wrapInstanceForDisk(instance), null, 2);
}
