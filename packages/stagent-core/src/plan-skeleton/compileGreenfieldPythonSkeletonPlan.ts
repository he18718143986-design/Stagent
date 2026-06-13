import { compilePlan } from '../plan-compiler/compilePlan';
import type { PlanPreflightResult, RunPlanPreflightOptions } from '../plan-preflight/PlanPreflightOrchestrator';
import {
  expandGreenfieldPythonSkeleton,
  type ExpandGreenfieldPythonSkeletonInput,
} from './expandGreenfieldPythonSkeleton';

/** 展开骨架 → Plan Compiler 全链（Phase0 验证门禁入口）。 */
export function compileGreenfieldPythonSkeletonPlan(
  skeletonInput: ExpandGreenfieldPythonSkeletonInput,
  compileOptions: RunPlanPreflightOptions,
): PlanPreflightResult {
  const { workflow } = expandGreenfieldPythonSkeleton(skeletonInput);
  return compilePlan(workflow, compileOptions);
}
