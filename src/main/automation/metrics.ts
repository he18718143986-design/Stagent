export interface AutomationMetricsSnapshot {
  started: number
  succeeded: number
  timedOut: number
  recoveredByAutoRepair: number
  bySite: Record<string, { started: number; succeeded: number; timedOut: number }>
}

const metrics: AutomationMetricsSnapshot = {
  started: 0,
  succeeded: 0,
  timedOut: 0,
  recoveredByAutoRepair: 0,
  bySite: {},
}

function ensureSite(siteId: string): { started: number; succeeded: number; timedOut: number } {
  if (!metrics.bySite[siteId]) {
    metrics.bySite[siteId] = { started: 0, succeeded: 0, timedOut: 0 }
  }
  return metrics.bySite[siteId]!
}

export function recordSendStarted(siteId: string): void {
  metrics.started += 1
  ensureSite(siteId).started += 1
}

export function recordSendSettled(siteId: string, timedOut: boolean): void {
  if (timedOut) {
    metrics.timedOut += 1
    ensureSite(siteId).timedOut += 1
    return
  }
  metrics.succeeded += 1
  ensureSite(siteId).succeeded += 1
}

export function recordRecoveredByAutoRepair(): void {
  metrics.recoveredByAutoRepair += 1
}

export function getAutomationMetrics(): AutomationMetricsSnapshot {
  return JSON.parse(JSON.stringify(metrics)) as AutomationMetricsSnapshot
}

export function resetAutomationMetrics(): void {
  metrics.started = 0
  metrics.succeeded = 0
  metrics.timedOut = 0
  metrics.recoveredByAutoRepair = 0
  metrics.bySite = {}
}

