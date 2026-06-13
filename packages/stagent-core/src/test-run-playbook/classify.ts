import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isJsTestRunCommand } from '../PlanCompletenessGate';
import { bundledRules } from './rules-bundled';
import { importRules } from './rules-import';
import { testRules } from './rules-test';
import { outputBlob } from './rules';
import type { ClassifyTestRunFailureInput, TestRunFailurePlaybook } from './types';

const allRules = [...bundledRules, ...testRules, ...importRules];

export function classifyTestRunFailure(input: ClassifyTestRunFailureInput): TestRunFailurePlaybook | null {
  const { stageId, command } = input;
  if (!isTestRunStageId(stageId) && !isJsTestRunCommand(command)) {
    return null;
  }

  const blob = outputBlob(input.stdout, input.stderr);
  for (const rule of allRules) {
    if (rule.match(blob, input)) {
      return rule.build(blob, input);
    }
  }
  return null;
}
