/**
 * M44：Webview / Engine 实例一致性 — 单一 Session 模型。
 * Webview 只缓存 sessionId；引擎为权威源，入站动作经 resolveSessionForAction 解析。
 */
import type { WorkflowInstance, WorkflowStatus } from './WorkflowDefinition';
import { canSwitchActiveInstance, type InstanceSwitchDecision } from './ActiveInstanceGuard';

/** 引擎侧活跃实例会话（sessionId === instanceKey）。 */
export interface InstanceSession {
  readonly id: string;
  instance: WorkflowInstance;
}

export function createInstanceSession(id: string, instance: WorkflowInstance): InstanceSession {
  return { id, instance };
}

export type SessionResolveKind =
  | 'use-active'
  | 'use-webview'
  | 'stale-webview-ignored'
  | 'missing';

export interface SessionResolveResult {
  kind: SessionResolveKind;
  /** 引擎应使用的 sessionId */
  sessionId?: string;
  /** webview 传入的 sessionId（与 active 不一致时） */
  webviewSessionId?: string;
}

/** 解析 webview 入站 sessionId：执行中忽略 stale key，否则以 webview 或 active 为准。 */
export function resolveSessionForAction(params: {
  activeSessionId: string | undefined;
  activeInstance: WorkflowInstance | undefined;
  webviewSessionId: string | undefined;
  executionDepth: number;
}): SessionResolveResult {
  const { activeSessionId, activeInstance, webviewSessionId, executionDepth } = params;

  if (!activeSessionId || !activeInstance) {
    if (webviewSessionId) {
      return { kind: 'use-webview', sessionId: webviewSessionId };
    }
    return { kind: 'missing' };
  }

  if (!webviewSessionId || webviewSessionId === activeSessionId) {
    return { kind: 'use-active', sessionId: activeSessionId };
  }

  if (
    shouldIgnoreStaleWebviewSession(
      activeSessionId,
      webviewSessionId,
      activeInstance.status,
      executionDepth,
    )
  ) {
    return {
      kind: 'stale-webview-ignored',
      sessionId: activeSessionId,
      webviewSessionId,
    };
  }

  return { kind: 'use-webview', sessionId: webviewSessionId };
}

/** @deprecated 使用 resolveSessionForAction；保留供既有单测与渐进迁移。 */
export function shouldIgnoreStaleWebviewSession(
  engineSessionId: string | undefined,
  webviewSessionId: string | undefined,
  instanceStatus: WorkflowStatus,
  executionDepth: number,
): boolean {
  if (!engineSessionId || !webviewSessionId || webviewSessionId === engineSessionId) {
    return false;
  }
  return instanceStatus === 'running' || instanceStatus === 'failed' || executionDepth > 0;
}

/** 切换活跃 session 前的守卫（委托 ActiveInstanceGuard）。 */
export function canSwitchToSession(params: {
  currentSessionId: string | undefined;
  targetSessionId: string;
  executionDepth: number;
}): InstanceSwitchDecision {
  return canSwitchActiveInstance({
    currentKey: params.currentSessionId,
    targetKey: params.targetSessionId,
    executionDepth: params.executionDepth,
  });
}

/** Backend → Webview：统一 session 同步消息（与 instanceKey 同值）。 */
export function buildSessionSyncedMessage(sessionId: string): {
  type: 'sessionSynced';
  sessionId: string;
  instanceKey: string;
} {
  return { type: 'sessionSynced', sessionId, instanceKey: sessionId };
}

/** Backend 消息附带 sessionId + instanceKey（同值，过渡期双写）。 */
export function withSessionFields(sessionId: string | undefined): {
  instanceKey?: string;
  sessionId?: string;
} {
  if (!sessionId) {
    return {};
  }
  return { instanceKey: sessionId, sessionId };
}

/** Backend 消息附带运行关联 traceId（与 per-task debug log 一致）。 */
export function withTraceId(traceId: string | undefined): { traceId?: string } {
  if (!traceId) {
    return {};
  }
  return { traceId };
}

/** session + trace 字段合并（生成/执行/HITL 出站消息统一关联）。 */
export function withCorrelationFields(
  sessionId: string | undefined,
  traceId: string | undefined,
): { instanceKey?: string; sessionId?: string; traceId?: string } {
  return { ...withSessionFields(sessionId), ...withTraceId(traceId) };
}
