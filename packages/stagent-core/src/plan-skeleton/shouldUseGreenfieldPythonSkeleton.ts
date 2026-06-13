import { detectMultiModuleLayout } from '../path-router/multiModuleLayoutDetect';

export interface GreenfieldPythonSkeletonGateInput {
  workflowTemplate?: string;
  taskType?: string;
  userInput?: string;
  /** 对应 PRD `contract.skeletonCompiler`（含 M5 条件默认 true）。 */
  skeletonCompilerEnabled?: boolean;
  stackProfile?: string;
  language?: string;
}

/**
 * 是否用骨架模板替代全量 JSON 生成（PRD §8.4 触发条件）。
 * `skeletonCompilerEnabled === true` 时启用（显式配置或 M5 默认）。
 */
export function shouldUseGreenfieldPythonSkeleton(input: GreenfieldPythonSkeletonGateInput): boolean {
  if (input.skeletonCompilerEnabled !== true) {
    return false;
  }
  const taskType = (input.taskType ?? '').trim().toLowerCase();
  if (taskType !== 'software') {
    return false;
  }
  if (input.workflowTemplate !== 'greenfield_full') {
    return false;
  }
  const lang = (input.language ?? input.stackProfile ?? '').toLowerCase();
  if (lang && lang !== 'python' && input.stackProfile !== 'python') {
    return false;
  }
  return detectMultiModuleLayout({ taskType, userInput: input.userInput });
}
