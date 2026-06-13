import type { BackendMessage, EngineActivityKind } from '../WorkflowDefinition';

export function postEngineActivity(
  postMessage: (panel: unknown, msg: BackendMessage) => void,
  panel: unknown,
  entry: { kind: EngineActivityKind; stageId?: string; text: string },
): void {
  postMessage(panel, {
    type: 'engineActivity',
    kind: entry.kind,
    stageId: entry.stageId,
    text: entry.text,
    timestamp: new Date().toISOString(),
  });
}
