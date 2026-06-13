import type { SkipCondition, StageRuntime } from './WorkflowDefinition';
import { anyTestRunFailed } from './execution/DeliveryBlockOnTestFailure';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from './WorkflowOutputKeys';

/** SPEC §4.1c：阶段 skipIf 条件求值 */
export function evaluateSkipCondition(condition: SkipCondition, runtimes: StageRuntime[]): boolean {
  if (condition.type === 'anyTestRunFailed') {
    return anyTestRunFailed(runtimes);
  }

  const ref = runtimes.find((r) => r.stageId === condition.stageId);
  if (!ref) {
    return false;
  }
  const key = condition.outputKey ?? CODE_RUNNER_EXIT_OUTPUT_KEY;
  switch (condition.type) {
    case 'exitCodeZero':
      return ref.outputs[key] === 0;
    case 'exitCodeNonZero':
      return typeof ref.outputs[key] === 'number' && ref.outputs[key] !== 0;
    case 'stageSkipped':
      return ref.status === 'skipped';
    case 'stageSkippedOrExitCodeZero':
      return ref.status === 'skipped' || ref.outputs[key] === 0;
    default:
      return false;
  }
}

export { anyTestRunFailed } from './execution/DeliveryBlockOnTestFailure';
