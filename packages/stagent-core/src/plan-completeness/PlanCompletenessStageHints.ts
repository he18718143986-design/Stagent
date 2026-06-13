/** M39.1：stage impl 语义中的测试基础设施关键词 */
export const TEST_INFRA_STAGE_ID_HINT =
  /(^|_)(jest|babel|tsconfig|test_infrastructure|test_setup|jest_expo|jest-expo|test_config)(_|$)/i;

/** main/入口装配：semantic 段关键词 */
export const MAIN_ASSEMBLY_STAGE_ID_HINT =
  /(^|_)(main|app|entry|cli|index|run|runner|start|launcher|__main__|monitor|orchestrat|pipeline|server|bootstrap_run|bootstrap)(_|$)/i;

export function isTestInfraStageSemantic(semantic: string): boolean {
  return TEST_INFRA_STAGE_ID_HINT.test(semantic);
}

export function isMainAssemblyStageSemantic(semantic: string): boolean {
  return MAIN_ASSEMBLY_STAGE_ID_HINT.test(semantic);
}
