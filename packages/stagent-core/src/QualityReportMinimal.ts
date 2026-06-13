import type { QualityReportPayload, WorkflowInstance } from './WorkflowDefinition';
import { buildQualityReportPayload } from './quality-report/buildQualityReportPayload';

/** @deprecated 使用 {@link buildQualityReportPayload}。 */
export function buildMinimalQualityReport(instance: WorkflowInstance): QualityReportPayload {
  return buildQualityReportPayload(instance);
}
