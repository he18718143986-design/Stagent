export const STAGE_ID_ZOOM_OUT = 'stage_zoom_out';
/** 引擎插入的全局架构决策阶段固定 id（与 SPEC §7.8 / Prompt 推荐一致）。 */
export const GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID = 'stage_decide_architecture_overview';
export const STAGE_ID_PREFIX_IMPL = 'stage_impl_';
export const STAGE_ID_PREFIX_TEST_RUN = 'stage_test_run_';
export const STAGE_ID_PREFIX_DECIDE = 'stage_decide_';
export const STAGE_ID_PREFIX_TEST_WRITE = 'stage_test_write_';

const RE_IMPL = /^stage_impl_/;
const RE_TEST_RUN = /^stage_test_run_/;
const RE_DECIDE = /^stage_decide_/;
const RE_TEST_WRITE = /^stage_test_write_/;
const RE_IMPL_SEMANTIC = /^stage_impl_(.+)$/;
const RE_DECIDE_SEMANTIC = /^stage_decide_(.+)$/;
const RE_TEST_RUN_SEMANTIC = /^stage_test_run_(.+)$/;
const RE_TEST_WRITE_SEMANTIC = /^stage_test_write_(.+)$/;
const RE_TDD_SEMANTIC = /^stage_(?:impl|test_write|test_run)_(.+)$/;
const RE_REFACTOR_DECIDE = /^stage_decide_refactor_/;
export const GLOBAL_ARCH_DECIDE_STAGE_ID_PATTERN =
  /^stage_decide_(architecture_overview|architecture|global_|project_architecture|full_stack|system_design)/i;
const RE_IMPL_OPTIONAL_PROTOTYPE = /^stage_impl_(?:prototype_)?/;

export function isImplStageId(stageId: string): boolean {
  return RE_IMPL.test(stageId);
}

export function isTestRunStageId(stageId: string): boolean {
  return RE_TEST_RUN.test(stageId);
}

export function isDecideStageId(stageId: string): boolean {
  return RE_DECIDE.test(stageId);
}

export function isTestWriteStageId(stageId: string): boolean {
  return RE_TEST_WRITE.test(stageId);
}

export function semanticNameFromImplStageId(id: string): string | undefined {
  const m = RE_IMPL_SEMANTIC.exec(id);
  return m?.[1];
}

export function semanticNameFromDecideStageId(id: string): string | undefined {
  const m = RE_DECIDE_SEMANTIC.exec(id);
  return m?.[1];
}

export function semanticNameFromTestRunStageId(id: string): string | undefined {
  const m = RE_TEST_RUN_SEMANTIC.exec(id);
  return m?.[1];
}

export function semanticNameFromTestWriteStageId(id: string): string | undefined {
  const m = RE_TEST_WRITE_SEMANTIC.exec(id);
  return m?.[1];
}

/** stage_impl_* / stage_test_write_* / stage_test_run_* → semantic slice name */
export function semanticNameFromTddStageId(id: string): string | undefined {
  const m = RE_TDD_SEMANTIC.exec(id);
  return m?.[1];
}

export function decideStageIdFromSemanticName(semanticName: string): string {
  return `${STAGE_ID_PREFIX_DECIDE}${semanticName}`;
}

export function implStageIdFromSemanticName(semanticName: string): string {
  return `${STAGE_ID_PREFIX_IMPL}${semanticName}`;
}

export function testRunStageIdFromSemanticName(semanticName: string): string {
  return `${STAGE_ID_PREFIX_TEST_RUN}${semanticName}`;
}

export function testWriteStageIdFromSemanticName(semanticName: string): string {
  return `${STAGE_ID_PREFIX_TEST_WRITE}${semanticName}`;
}

export function isRefactorDecideStageId(stageId: string): boolean {
  return RE_REFACTOR_DECIDE.test(stageId);
}

export function isGlobalArchitectureDecideStageId(stageId: string): boolean {
  return GLOBAL_ARCH_DECIDE_STAGE_ID_PATTERN.test(stageId);
}

/** PlanCompletenessGate：impl 语义名，去掉 prototype_ 前缀 */
export function semanticNameForPlanCompleteness(stageId: string): string {
  const fromImpl = semanticNameFromImplStageId(stageId);
  if (fromImpl) {
    return fromImpl.replace(/^prototype_/, '');
  }
  const bare = stageId.replace(RE_IMPL_OPTIONAL_PROTOTYPE, '');
  return bare === stageId ? stageId : bare;
}
