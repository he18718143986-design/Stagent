export type UpstreamFixRejectReason =
  | 'no-instance'
  | 'stage-not-actionable'
  | 'not-eligible'
  | 'no-upstream-impl'
  | 'retry-limit-exceeded';

export type UpstreamFixResult =
  | { ok: true; targetImplStageId: string }
  | { ok: false; reason: UpstreamFixRejectReason; message: string };
