/**
 * 运行与授权之后的钩子：埋点（§14）、文件归属（§4.5）、合并后的记录卡（§10）。
 * 钩子失败绝不影响主流程。
 */
import type { EventOf } from '../../ledger/types.js';
import { recordMetric } from '../../metrics/metrics.js';
import type { AuthRequest, AuthResult } from '../auth.js';
import type { StagentService } from '../service.js';
import { ensureAttribution } from './map-flow.js';
import { draftRecordsAfterMerge } from './records-flow.js';

export async function afterRunHooks(svc: StagentService, runs: EventOf<'run.completed'>[]): Promise<void> {
  const projectId = svc.ledger.projectId;
  for (const run of runs) {
    if (!run.valid) await recordMetric(projectId, 'run.invalid', { purpose: run.purpose });
    const flaky = run.results.filter((r) => r.status === 'flaky').length;
    if (flaky) await recordMetric(projectId, 'flaky.detected', { count: flaky });
  }
  const last = runs.at(-1);
  if (!last || last.purpose !== 'regression' || !last.changeId) return;
  const snap = await svc.state();
  const active = snap.changes.active;
  if (active?.changeId !== last.changeId) return;
  // 已验收功能被破坏、在合并前就被全量回归发现（§14「真实价值」）。
  const broken = snap.projection.features.filter((f) => f.state === 'broken' && !active.targetFeatureIds.includes(f.featureId));
  if (broken.length) await recordMetric(projectId, 'regression.caught', { features: broken.length });
  await ensureAttribution(svc, last.changeId);
}

export async function afterAuthHooks(svc: StagentService, req: AuthRequest, result: AuthResult): Promise<void> {
  if ((result.action === 'merge' || result.action === 'merge_override') && typeof req.changeId === 'string') {
    await draftRecordsAfterMerge(svc, req.changeId);
  }
}
