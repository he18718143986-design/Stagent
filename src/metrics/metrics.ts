/**
 * 产品健康指标埋点（规格 §14）：写入 ~/.stagent/metrics.jsonl，不进入事件链、不提交 git。
 * 埋点失败绝不影响主流程。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { metricsPath } from '../home/home.js';

/** 已知的指标名（前端也可以上报 ui.* 指标）。 */
export type MetricName =
  | 'examples.confirmed' // 例子确认时的修改率
  | 'decision.dwell' // 决策卡停留时间
  | 'regression.caught' // 已验收功能被破坏、合并前被全量回归发现
  | 'claim.refuted' // 仅 AI 声称被系统证伪
  | 'run.invalid' // run 被判 valid=false
  | 'red_check.result' // 先失败检查合格 / 不合格
  | 'red_check.waived' // 先失败检查豁免
  | 'flaky.detected'
  | 'plan.created'
  | 'map.unassigned_ratio'
  | `ui.${string}`;

export async function recordMetric(projectId: string | null, name: MetricName, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const path = metricsPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify({ at: new Date().toISOString(), projectId, name, ...data }) + '\n');
  } catch {
    // 埋点失败不影响主流程
  }
}

export async function readMetrics(projectId?: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(metricsPath(), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((m) => !projectId || m.projectId === projectId);
  } catch {
    return [];
  }
}
