import type { CodeRunnerConfig, WorkflowDefinition } from '../../WorkflowDefinition';
import type { Stage } from '../../WorkflowDefinition';
import {
  collectAllCodeRunnerLintIssues,
  formatCodeRunnerCommandIssue,
  isDangerousCommandIssue,
} from '../../CodeRunnerCommandLint';
import { readDangerousCommandLintMode } from '../../settings/SettingsReaders';
import { isCodeRunnerTool } from '../../workflow/StageToolKinds';

export function validateCodeRunnerToolConfig(
  stage: Stage,
  wf: WorkflowDefinition,
  stageIndex: number,
): string[] {
  const errors: string[] = [];
  if (!isCodeRunnerTool(stage.tool)) {
    return errors;
  }
  const cfg = stage.toolConfig as Partial<CodeRunnerConfig>;
  if (!cfg.command || !String(cfg.command).trim()) {
    errors.push(`工具配置错误：阶段 ${stage.id} (code-runner) 缺少 command`);
    return errors;
  }
  const dangerousMode = readDangerousCommandLintMode();
  for (const issue of collectAllCodeRunnerLintIssues(String(cfg.command), wf, stageIndex)) {
    if (isDangerousCommandIssue(issue) && (dangerousMode === 'warn' || dangerousMode === 'off')) {
      continue;
    }
    errors.push(formatCodeRunnerCommandIssue(stage.id, issue));
  }
  return errors;
}
