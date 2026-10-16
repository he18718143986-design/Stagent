import type { ChangeView, ChangesProjection } from '../../src/changes/changes';
import type { Overview } from '../../src/projection/overview';
import type { FeatureView } from '../../src/projection/projection';
import type { ChangeDiffView, MapView } from '../../src/server/flows/map-flow';
import type { PlanView, PlansProjection } from '../../src/plans/plans';
import type { RecordsResponse } from '../../src/server/flows/records-flow';
import type { PendingDraft } from '../../src/changes/changes';

export type { CardAction, CardStatus, Overview } from '../../src/projection/overview';
export type { ExampleView, FeatureView, UnverifiedReason } from '../../src/projection/projection';
export type { ChangePhase, ChangeView, ChangesProjection, PendingDraft } from '../../src/changes/changes';
export type { ChangeDiffView, MapView } from '../../src/server/flows/map-flow';
export type { PlanView, PlansProjection, StepView } from '../../src/plans/plans';
export type { RecordsResponse } from '../../src/server/flows/records-flow';

export interface AgentTaskView {
  kind: string;
  label: string;
  changeId: string | null;
  line: string;
  log: string[];
  startedAt: string;
  sessionId: string | null;
}

export type OverviewResponse = Overview & {
  runError: string | null;
  project: { name: string; branch: string | null; port?: number };
  auth: {
    dangling: { authId: string; action: string; changeId?: string; at: string; reason: string }[];
    tamperedChecks: { exampleId: string; featureId: string; featureName: string; checkPath: string; problem: string }[];
    releaseConfigured: boolean;
  };
  agent: { name: string | null; availability: { available: boolean; reason?: string; hint?: string }; task: AgentTaskView | null; lastError: string | null };
  budget: {
    todayCost: number;
    changeCost: number;
    perDay: number | null;
    perChange: number | null;
    exceeded: null | { scope: 'perChange' | 'perDay'; limit: number; spent: number };
  };
};

export type BaselineDraft = PendingDraft & { featureName: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export const api = {
  overview: () => request<OverviewResponse>('GET', '/api/overview'),
  features: () => request<FeatureView[]>('GET', '/api/features'),
  feature: (id: string) => request<FeatureView>('GET', `/api/features/${encodeURIComponent(id)}`),
  startRun: () => request<{ total: number }>('POST', '/api/runs'),
  cancelRun: () => request<{ ok: true }>('POST', '/api/runs/current/cancel'),
  acceptLedger: (reason: string) => request<{ ok: true }>('POST', '/api/ledger/accept', { reason }),
  changes: () => request<ChangesProjection>('GET', '/api/changes'),
  createChange: (description: string, track?: 'small' | 'feature', force?: boolean) =>
    request<ChangeView | { suggestPlan: true; rationale: string }>('POST', '/api/changes', { description, ...(track ? { track } : {}), ...(force ? { force } : {}) }),
  setTrack: (changeId: string, track: 'small' | 'feature') =>
    request<ChangeView>('POST', `/api/changes/${encodeURIComponent(changeId)}/track`, { track }),
  draftExample: (changeId: string, body: Record<string, string>) =>
    request<{ exampleId: string; featureId: string }>('POST', `/api/changes/${encodeURIComponent(changeId)}/examples`, body),
  lockExamples: (changeId: string) => request<ChangeView>('POST', `/api/changes/${encodeURIComponent(changeId)}/examples/lock`, {}),
  startCheck: (changeId: string) => request<{ total: number }>('POST', `/api/changes/${encodeURIComponent(changeId)}/check`),
  merge: (changeId: string) => request<AuthResult>('POST', `/api/changes/${encodeURIComponent(changeId)}/merge`),
  authorize: (body: { action: string; reason: string } & Record<string, unknown>) => request<AuthResult>('POST', '/api/auth', body),
  abandonPreview: (changeId: string) =>
    request<{ restoreTo: string; files: { path: string; status: string }[]; note: string }>(
      'GET',
      `/api/changes/${encodeURIComponent(changeId)}/abandon-preview`,
    ),
  dismissDangling: (authId: string) => request<{ ok: true }>('POST', `/api/auth/${encodeURIComponent(authId)}/dismiss`),
  restoreExample: (exampleId: string) => request<{ ok: true }>('POST', `/api/examples/${encodeURIComponent(exampleId)}/restore`),
  relockExample: (exampleId: string, body: Record<string, string> = {}) =>
    request<{ ok: true }>('POST', `/api/examples/${encodeURIComponent(exampleId)}/relock`, body),
  // Claude Code（M3）
  draftWithAgent: (changeId: string) => request<{ started: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/draft`),
  implement: (changeId: string) => request<{ started: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/implement`),
  fix: (changeId: string) => request<{ started: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/fix`),
  resume: (changeId: string) => request<{ started: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/resume`),
  cancelAgent: () => request<{ ok: true }>('POST', '/api/agent/cancel'),
  redCheck: (changeId: string, exampleIds?: string[]) =>
    request<{ runId: string; results: { exampleId: string; status: string; qualified: boolean }[] }>(
      'POST',
      `/api/changes/${encodeURIComponent(changeId)}/red-check`,
      exampleIds ? { exampleIds } : {},
    ),
  redWaive: (changeId: string, exampleId: string, reason: string) =>
    request<{ ok: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/examples/${encodeURIComponent(exampleId)}/red-waive`, { reason }),
  rewrite: (changeId: string, exampleId: string) =>
    request<{ started: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/examples/${encodeURIComponent(exampleId)}/rewrite`),
  discard: (changeId: string, exampleId: string, reason?: string) =>
    request<{ ok: true }>('POST', `/api/changes/${encodeURIComponent(changeId)}/examples/${encodeURIComponent(exampleId)}/discard`, reason ? { reason } : {}),
  ask: (cardId: string, question: string, card: { question: string; background: string; options: { label: string; pros?: string; cons?: string }[] }) =>
    request<{ answer: string }>('POST', `/api/decisions/${encodeURIComponent(cardId)}/ask`, { question, card }),
  // 外观与改了什么（M4-2）
  confirmVisual: (exampleId: string, ok: boolean, note?: string) =>
    request<{ ok: true }>('POST', `/api/visual/${encodeURIComponent(exampleId)}`, { ok, ...(note ? { note } : {}) }),
  diff: (changeId: string) => request<ChangeDiffView>('GET', `/api/changes/${encodeURIComponent(changeId)}/diff`),
  setAttributions: (changeId: string, attributions: { path: string; featureIds: string[] }[]) =>
    request<unknown>('PUT', `/api/changes/${encodeURIComponent(changeId)}/attributions`, { attributions }),
  setDevServer: (command: string, url: string) => request<{ ok: true }>('POST', '/api/config/dev-server', { command, url }),
  // 接入（M4-1）
  scan: () => request<{ started: true }>('POST', '/api/scan'),
  baselineDraft: (featureId: string) => request<{ started: true }>('POST', `/api/features/${encodeURIComponent(featureId)}/baseline`),
  baseline: () => request<{ drafts: BaselineDraft[] }>('GET', '/api/baseline'),
  editDraft: (exampleId: string, body: Record<string, string>) => request<{ ok: true }>('PUT', `/api/examples/${encodeURIComponent(exampleId)}/draft`, body),
  lockBaseline: (exampleIds: string[]) => request<{ locked: number }>('POST', '/api/baseline/lock', { exampleIds }),
  knownInconsistent: (exampleId: string, reason: string) =>
    request<{ ok: true }>('POST', `/api/examples/${encodeURIComponent(exampleId)}/known-inconsistent`, { reason }),
  // 系统地图（M4-3）
  map: () => request<MapView>('GET', '/api/map'),
  fileFeatures: (path: string) => request<{ path: string; features: { featureId: string; name: string }[] }>('GET', `/api/map/files?path=${encodeURIComponent(path)}`),
  reassign: (path: string, featureIds: string[]) => request<unknown>('POST', '/api/map/files', { path, featureIds }),
  // 需求计划（M4-4）
  plans: () => request<PlansProjection>('GET', '/api/plans'),
  draftPlan: (requirement: string) => request<PlanView>('POST', '/api/plans', { requirement }),
  confirmPlan: (planId: string, steps?: unknown[]) => request<PlanView>('POST', `/api/plans/${encodeURIComponent(planId)}/confirm`, steps ? { steps } : {}),
  revisePlan: (planId: string, steps: unknown[], reason: string) => request<PlanView>('POST', `/api/plans/${encodeURIComponent(planId)}/revise`, { steps, reason }),
  closePlan: (planId: string, outcome: 'completed' | 'cancelled', reason?: string) =>
    request<PlanView>('POST', `/api/plans/${encodeURIComponent(planId)}/close`, { outcome, ...(reason ? { reason } : {}) }),
  startStep: (planId: string, stepId: string) => request<ChangeView>('POST', `/api/plans/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}/start`),
  // 记录与规则（M5-1）
  records: () => request<RecordsResponse>('GET', '/api/records'),
  saveRecord: (body: Record<string, unknown>) => request<{ recordId: string }>('POST', '/api/records', body),
  dismissRecordDraft: (draftId: string) => request<{ ok: true }>('POST', `/api/records/drafts/${encodeURIComponent(draftId)}/dismiss`),
  acceptRule: (ruleId: string, body: Record<string, unknown> = {}) => request<{ ok: true }>('POST', `/api/rules/${encodeURIComponent(ruleId)}/accept`, body),
  retireRule: (ruleId: string) => request<{ ok: true }>('POST', `/api/rules/${encodeURIComponent(ruleId)}/retire`),
  regenerateRules: () => request<{ ok: true }>('POST', '/api/rules/regenerate'),
  keepRules: () => request<{ ok: true }>('POST', '/api/rules/keep'),
  library: () => request<{ stack: string[]; items: { id: string; kind: string; title: string; body: string; tags: string[] }[] }>('GET', '/api/library'),
  importLibrary: (id: string) => request<{ ruleId: string }>('POST', `/api/library/${encodeURIComponent(id)}/import`),
  // 账本恢复（M6）
  recoverLedger: (mode: 'accept_current' | 'establish_trust' | 'from_git', reason = '') => request<{ ok: true }>('POST', '/api/ledger/recover', { mode, reason }),
  metric: (name: string, data: Record<string, unknown> = {}) => request<{ ok: true }>('POST', '/api/metrics', { name, data }).catch(() => undefined),
};

/** 运行产物（截图 / 日志）的地址。 */
export function fileUrl(path: string): string {
  return `/api/files?path=${encodeURIComponent(path)}`;
}

export interface AuthResult {
  authId: string;
  action: string;
  ok: boolean;
  detail?: string;
  mergeCommit?: string;
  exitCode?: number;
}

/** 订阅服务端事件；任何事件都触发 onChange。EventSource 自带 Last-Event-ID 续传。 */
export function subscribe(onChange: (type: string) => void): () => void {
  const es = new EventSource('/api/events/stream');
  const types = [
    'run.started',
    'run.progress',
    'run.finished',
    'run.failed',
    'ledger.appended',
    'ledger.locked',
    'change.started',
    'workspace.changed',
    'agent.started',
    'agent.progress',
    'agent.finished',
    'agent.failed',
    'scan.feature',
    'scan.finished',
    'records.drafted',
    'resync',
  ];
  for (const t of types) es.addEventListener(t, () => onChange(t));
  return () => es.close();
}
