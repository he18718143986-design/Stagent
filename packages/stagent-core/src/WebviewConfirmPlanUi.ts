/** 确认页计划审查 UI 纯函数（注入 Webview `<script>`，与 WorkflowArtifactRegistry 路径规则对齐） */

export interface ConfirmPlanStage {
  id: string;
  title: string;
  tool: string;
  toolConfig?: Record<string, unknown>;
  pauseAfter?: boolean;
  isDecisionStage?: boolean;
  aiTip?: string;
}

export function normalizeArtifactPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function getStageArtifactPath(stage: ConfirmPlanStage): string | undefined {
  const tc = stage.toolConfig;
  if (!tc) {
    return undefined;
  }
  if (stage.tool === 'llm-text' && typeof tc.writeOutputToFile === 'string' && tc.writeOutputToFile.trim()) {
    return normalizeArtifactPath(tc.writeOutputToFile);
  }
  if (
    (stage.tool === 'file-write' || stage.tool === 'file-read') &&
    typeof tc.filePath === 'string' &&
    tc.filePath.trim()
  ) {
    return normalizeArtifactPath(tc.filePath);
  }
  return undefined;
}

export function collectArtifactPathsFromStages(stages: ConfirmPlanStage[]): string[] {
  const pathSet = new Set<string>();
  for (const s of stages) {
    const p = getStageArtifactPath(s);
    if (p) {
      pathSet.add(p);
    }
  }
  return [...pathSet].sort();
}

export function getArtifactHeuristicWarnings(
  paths: string[],
  stages: ConfirmPlanStage[],
): string[] {
  const warnings: string[] = [];
  const pathSet = new Set(paths);
  if (pathSet.has('config.yaml') && !pathSet.has('config.py')) {
    warnings.push(
      '存在 config.yaml 但无 config.py：stage_test_run_* 勿使用 from config import，应 yaml.safe_load 或增加 config.py 阶段。',
    );
  }
  const hasTestRun = stages.some((s) => /^stage_test_run_/.test(s.id) && s.tool === 'code-runner');
  if (hasTestRun && paths.length === 0) {
    warnings.push('存在 test_run 阶段但未登记任何落盘路径，请核对 writeOutputToFile / file-write。');
  }
  return warnings;
}

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

export interface ConfirmStatsInput {
  taskType?: string;
  stageCount: number;
  decisionCount: number;
  implCount: number;
  testRunCount: number;
  pauseCount: number;
}

export function buildConfirmStatsLines(stats: ConfirmStatsInput): string[] {
  const typeLabel = stats.taskType ? `任务类型 ${stats.taskType}` : '';
  const parts = [
    typeLabel,
    `${stats.stageCount} 个阶段`,
    `${stats.decisionCount} 决策`,
    `${stats.implCount} 实现`,
    stats.testRunCount > 0 ? `${stats.testRunCount} test_run` : '',
    `${stats.pauseCount} 个审核暂停点`,
  ].filter(Boolean);
  return parts;
}

export function countStagesByKind(stages: ConfirmPlanStage[]): Omit<ConfirmStatsInput, 'taskType'> {
  let decisionCount = 0;
  let implCount = 0;
  let testRunCount = 0;
  let pauseCount = 0;
  for (const s of stages) {
    if (s.isDecisionStage) {
      decisionCount += 1;
    }
    if (/^stage_impl_/.test(s.id)) {
      implCount += 1;
    }
    if (/^stage_test_run_/.test(s.id)) {
      testRunCount += 1;
    }
    if (s.pauseAfter) {
      pauseCount += 1;
    }
  }
  return {
    stageCount: stages.length,
    decisionCount,
    implCount,
    testRunCount,
    pauseCount,
  };
}
