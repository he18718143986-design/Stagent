export type HitlRetryRejectReason = 'no-instance' | 'stage-not-actionable' | 'retry-limit-exceeded';
export type HitlRetryResult = { ok: true } | { ok: false; reason: HitlRetryRejectReason; message: string };
