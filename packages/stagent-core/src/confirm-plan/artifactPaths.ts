import { resolveWebviewString } from '../webview/l10n/resolveWebviewString';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import {
  collectArtifactPathsFromStages as collectArtifactPathsFromStagesCore,
  getStageArtifactPath as getStageArtifactPathCore,
  normalizeArtifactRelativePath,
} from '../workflow/stageArtifactPaths';
import type { ConfirmPlanStage } from './types';

/** @deprecated Use `normalizeArtifactRelativePath` from `workflow/stageArtifactPaths`. */
export function normalizeArtifactPath(filePath: string): string {
  return normalizeArtifactRelativePath(filePath);
}

export function getStageArtifactPath(stage: ConfirmPlanStage): string | undefined {
  return getStageArtifactPathCore(stage);
}

export function collectArtifactPathsFromStages(stages: ConfirmPlanStage[]): string[] {
  return collectArtifactPathsFromStagesCore(stages);
}

export function getArtifactHeuristicWarnings(
  paths: string[],
  stages: ConfirmPlanStage[],
): string[] {
  const warnings: string[] = [];
  const pathSet = new Set(paths);
  if (pathSet.has('config.yaml') && !pathSet.has('config.py')) {
    warnings.push(resolveWebviewString('stagent.webview.plan.artifactConfigYaml'));
  }
  const hasTestRun = stages.some((s) => isTestRunStageId(s.id) && isCodeRunnerTool(s.tool));
  if (hasTestRun && paths.length === 0) {
    warnings.push(resolveWebviewString('stagent.webview.plan.artifactNoPaths'));
  }
  return warnings;
}
