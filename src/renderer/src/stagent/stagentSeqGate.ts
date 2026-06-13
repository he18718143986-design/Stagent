import type { BackendMessage } from '@stagent/core'

export type SeqGatedMessage = BackendMessage & { seq?: number; uiEpoch?: number }

export function shouldDropStaleMessage(
  msg: SeqGatedMessage,
  cursor: { lastSeq: number; uiEpoch: number },
): boolean {
  if (msg.uiEpoch !== undefined) {
    if (msg.uiEpoch < cursor.uiEpoch) {
      return true
    }
    if (msg.uiEpoch > cursor.uiEpoch) {
      cursor.uiEpoch = msg.uiEpoch
      cursor.lastSeq = 0
    }
  }
  if (msg.type === 'instanceResumed' && msg.resync) {
    cursor.uiEpoch = msg.uiEpoch ?? cursor.uiEpoch + 1
    cursor.lastSeq = 0
  }
  if (
    (msg.type === 'stageError' || msg.type === 'stageStatusUpdate') &&
    msg.seq !== undefined
  ) {
    if (msg.seq < cursor.lastSeq) {
      return true
    }
    cursor.lastSeq = msg.seq
  }
  return false
}
