import { isTestRunStageId } from '../../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../../workflow/StageToolKinds';
import type { WorkflowDefinition } from '../../WorkflowDefinition';
import type { CodeRunnerConfig, Stage } from '../../WorkflowDefinition';

const DEFAULT_TEST_RUN_COMMAND = 'npm test';

function inferTestRunCommand(stage: Stage): string {
  const cfg = stage.toolConfig as { command?: string };
  if (typeof cfg?.command === 'string' && cfg.command.trim()) {
    return cfg.command.trim();
  }
  const tc = stage.toolConfig as { type?: string; systemPrompt?: string };
  if (tc?.type === 'llm-text' && typeof tc.systemPrompt === 'string') {
    const p = tc.systemPrompt;
    if (/\bnpm\s+run\s+test\b/i.test(p)) {
      return 'npm run test';
    }
    if (/\bnpm\s+test\b/i.test(p)) {
      return 'npm test';
    }
  }
  return DEFAULT_TEST_RUN_COMMAND;
}

/** Rule20：stage_test_run_* 必须为 code-runner（任意 taskType）。 */
export function fixTestRunStagesMustUseCodeRunner(wf: WorkflowDefinition): void {
  for (const stage of wf.stages) {
    if (!isTestRunStageId(stage.id) || isCodeRunnerTool(stage.tool)) {
      continue;
    }
    const command = inferTestRunCommand(stage);
    const prev = stage.toolConfig as Partial<CodeRunnerConfig> & { pathBase?: CodeRunnerConfig['pathBase'] };
    const toolConfig: CodeRunnerConfig = {
      type: 'code-runner',
      command,
      captureOutput: prev.captureOutput ?? true,
      ...(prev.workingDir ? { workingDir: prev.workingDir } : {}),
      ...(prev.pathBase ? { pathBase: prev.pathBase } : {}),
      ...(typeof prev.timeout === 'number' ? { timeout: prev.timeout } : {}),
    };
    stage.tool = 'code-runner';
    stage.toolConfig = toolConfig;
  }
}
