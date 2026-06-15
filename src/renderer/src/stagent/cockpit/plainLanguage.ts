/** 渲染层友好文案 — 从 core 纯 TS 源 import，禁止走 CJS barrel（Vite ESM 无法解析）。 */
export { humanizeJargon } from '@stagent/friendly/TranslationGlossary';
export {
  plainTaskTypeLabel,
  plainProvenanceLabel,
  plainDecisionKindLabel,
  plainToolLabel,
  plainDecisionBoardSummary,
} from '@stagent/friendly/toPlainLanguage';
export { formatPlanSummaryLines } from '@stagent/plan-summary';
