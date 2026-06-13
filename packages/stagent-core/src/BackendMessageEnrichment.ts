/**
 * WorkflowUiBridge / 宿主 postMessage 出站字段注入（traceId、instanceKey）。
 */
import { withTraceId } from './InstanceSession';
import { buildQualityReportPayload } from './quality-report/buildQualityReportPayload';
import type { BackendMessage } from './WorkflowDefinition';
import type { MessagingHost } from './engine-host/MessagingHost';

export function enrichBackendMessageTraceId(host: MessagingHost, msg: BackendMessage): BackendMessage {
  if (msg.type !== 'stageError' && msg.type !== 'workflowFailed' && msg.type !== 'workflowCompleted') {
    return msg;
  }
  if (msg.traceId) {
    return msg;
  }
  const traceId = host.getInstance()?.traceId;
  return { ...msg, ...withTraceId(traceId) };
}

/** 执行期消息注入 instanceKey/sessionId（与 M44 session 指针对齐）。 */
export function enrichBackendMessageInstanceKey(host: MessagingHost, msg: BackendMessage): BackendMessage {
  const existing = msg.instanceKey ?? msg.sessionId;
  if (existing) {
    return {
      ...msg,
      instanceKey: msg.instanceKey ?? existing,
      sessionId: msg.sessionId ?? existing,
    };
  }
  const key = host.getCurrentInstanceKey();
  if (!key) {
    return msg;
  }
  return { ...msg, instanceKey: key, sessionId: key };
}

function enrichWorkflowCompletedQualityReport(host: MessagingHost, msg: BackendMessage): BackendMessage {
  if (msg.type !== 'workflowCompleted' || msg.qualityReport) {
    return msg;
  }
  const instance = host.getInstance();
  if (!instance || instance.status !== 'completed') {
    return msg;
  }
  return { ...msg, qualityReport: buildQualityReportPayload(instance) };
}

export function enrichBackendMessageForWebview(
  host: MessagingHost,
  msg: BackendMessage,
  seq: number,
  uiEpoch: number,
): BackendMessage {
  const withSeq = enrichBackendMessageInstanceKey(
    host,
    enrichBackendMessageTraceId(host, { ...msg, seq, uiEpoch }),
  );
  return enrichWorkflowCompletedQualityReport(host, withSeq);
}
