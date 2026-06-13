import type { WatchResult } from '../response-watcher'
import { isLikelyAuthorLabel } from '../response-watcher'
import type { FailureCode } from './failure-codes'

export interface ClassificationInput {
  timedOut?: boolean
  watchResult?: WatchResult
  timeoutHint?: string
  detail?: string
}

export interface ClassificationOutput {
  code: FailureCode
  confidence: 'high' | 'medium' | 'low'
  retryable: boolean
  reason: string
}

export function classifyFailure(input: ClassificationInput): ClassificationOutput {
  const hint = (input.timeoutHint ?? '').toLowerCase()
  const detail = (input.detail ?? '').toLowerCase()
  const wr = input.watchResult

  if (hint.includes('证书') || hint.includes('ssl') || hint.includes('proxy')) {
    return { code: 'CERT_OR_PROXY_ANOMALY', confidence: 'high', retryable: false, reason: 'timeout-hint-cert-proxy' }
  }
  if (wr?.text && isLikelyAuthorLabel(wr.text)) {
    return { code: 'DOM_AUTHOR_LABEL_ONLY', confidence: 'high', retryable: true, reason: 'label-only' }
  }
  if (wr?.timedOut && (!wr.text || wr.text.trim().length === 0)) {
    return { code: 'TIMEOUT_EMPTY_BODY', confidence: 'high', retryable: true, reason: 'timed-out-empty' }
  }
  if (detail.includes('no resource with given identifier')) {
    return { code: 'CDP_NO_RESPONSE_BODY', confidence: 'medium', retryable: true, reason: 'cdp-no-response-body' }
  }
  if (detail.includes('length: 0') || detail.includes('empty-text')) {
    return { code: 'SSE_EMPTY_BODY', confidence: 'medium', retryable: true, reason: 'sse-empty' }
  }
  if (input.timedOut) {
    return { code: 'TIMEOUT_EMPTY_BODY', confidence: 'medium', retryable: true, reason: 'generic-timeout' }
  }
  return { code: 'UNKNOWN', confidence: 'low', retryable: false, reason: 'fallback' }
}

