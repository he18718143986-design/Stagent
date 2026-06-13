export type AutomationStage =
  | 'send'
  | 'inject'
  | 'network'
  | 'dom'
  | 'settle'
  | 'repair'

export type FailureCode =
  | 'PW_AMBIGUOUS_PAGE'
  | 'PW_CDP_CONNECT_FAILED'
  | 'PW_NO_BOUND_PAGE'
  | 'SSE_EMPTY_BODY'
  | 'CDP_NO_RESPONSE_BODY'
  | 'DOM_AUTHOR_LABEL_ONLY'
  | 'DOM_STALE_PREVIOUS_TURN'
  | 'CERT_OR_PROXY_ANOMALY'
  | 'NAVIGATION_INTERRUPTED'
  | 'INJECT_FAILED'
  | 'RACE_REPLY_ERROR'
  | 'TIMEOUT_EMPTY_BODY'
  | 'UNKNOWN'

export interface FailureContext {
  sendSeq: string
  stage: AutomationStage
  siteId: string
  hostname: string
  automationPath: 'playwright' | 'legacy'
  errorCode: FailureCode
  detail: string
  retryable: boolean
}

export function buildSendSeq(siteId: string): string {
  return `${siteId.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

