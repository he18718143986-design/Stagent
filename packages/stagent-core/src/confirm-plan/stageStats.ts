import { resolveWebviewString } from '../webview/l10n/resolveWebviewString';
import { countStagesByKind as countStagesByKindCore } from '../workflow/StageKindCounts';
import type { ConfirmPlanStage, ConfirmStatsInput } from './types';

export function parsePhaseFromTitle(title: string): string | null {
  const m = title.match(/^\[Phase (\d+)\]/i);
  return m ? `Phase ${m[1]}` : null;
}

export function stripPhasePrefix(title: string): string {
  return title.replace(/^\[Phase \d+\]\s*/i, '').trim();
}

export function truncateConfirmText(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) {
    return t;
  }
  return `${t.slice(0, maxLen)}…`;
}

export function buildConfirmStatsLines(stats: ConfirmStatsInput): string[] {
  const typeLabel = stats.taskType ? resolveWebviewString('stagent.webview.plan.statsTaskType', stats.taskType) : '';
  const parts = [
    typeLabel,
    resolveWebviewString('stagent.webview.plan.statsStages', stats.stageCount),
    resolveWebviewString('stagent.webview.plan.statsDecision', stats.decisionCount),
    resolveWebviewString('stagent.webview.plan.statsImpl', stats.implCount),
    stats.testRunCount > 0 ? `${stats.testRunCount} test_run` : '',
    resolveWebviewString('stagent.webview.plan.statsPause', stats.pauseCount),
  ].filter(Boolean);
  return parts;
}

export function countStagesByKind(stages: ConfirmPlanStage[]): Omit<ConfirmStatsInput, 'taskType'> {
  return countStagesByKindCore(stages);
}
