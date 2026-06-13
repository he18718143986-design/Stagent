import type { AfkAcceptanceReport } from '../afk/evaluateAfkAcceptance';
import type { DiagnosticRoute } from '../diagnostic-router';

/** Webview 屏 5：客观验证行（A 轨）。 */
export interface QualityReportVerificationRow {
  stageId: string;
  passCount: number;
  totalRuns: number;
  stable: boolean;
  flaky: boolean;
}

/** workflowCompleted.qualityReport 载荷（与 P0–P3d 引擎对齐）。 */
export interface QualityReportPayload {
  afk: AfkAcceptanceReport;
  verificationRows: QualityReportVerificationRow[];
  engineSummary: string;
  diagnosticRoutes?: DiagnosticRoute[];
}
