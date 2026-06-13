/**
 * M41：HITL 动作协调层 — approve / approveDecision / answerQuestions* / retry。
 * Re-export shim：实现已拆分至 hitl/*。
 */
export type { HitlCoordinatorHost } from './hitl/HitlCoordinatorHost';
export {
  handleApprove,
  handleApproveDecision,
  handleAnswerQuestions,
  handleAnswerQuestionsBefore,
  handleRetry,
} from './hitl';
export { handleUpstreamFix } from './retry/UpstreamFix';
