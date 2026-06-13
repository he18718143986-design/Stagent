/**
 * 内置 QualityGate 注册 id（单点定义；debugLog event 与 gate id 字面量一致）。
 */

/** 生成期 */
export const GATE_ID_SCHEMA_VALIDATION = 'schema-validation';
export const GATE_ID_RULE20_VIOLATIONS = 'rule20-violations';
export const GATE_ID_PLAN_COMPLETENESS = 'plan-completeness';
/** software TDD 链硬阻断（missing-test-run-pair 等；不依赖 plan.requireCompleteness）。 */
export const GATE_ID_PLAN_COMPLETENESS_HARD = 'plan-completeness-hard';
export const GATE_ID_GENERATOR_META_WARNINGS = 'generator-meta-warnings';
export const GATE_ID_DEPENDENCY_GRAPH_WARNINGS = 'dependency-graph-warnings';
export const GATE_ID_COMPLEXITY_WARNINGS = 'complexity-warnings';
export const GATE_ID_PROTOTYPE_DATA_CONTRACT = 'prototype-data-contract';
export const GATE_ID_STATIC_ANALYSIS_ON_GENERATE = 'static-analysis-on-generate';

/** pre-stage（动态 debugLog / 分支比较） */
export const GATE_ID_DEBUG_FEEDBACK_LOOP = 'debug-feedback-loop';
export const GATE_ID_RED_GREEN_PRE_IMPL = 'red-green-pre-impl';
export const GATE_ID_IMPL_WRITE_SCOPE = 'impl-write-scope';
export const GATE_ID_PYTHON_VENV_BOOTSTRAP = 'python-venv-bootstrap';
export const GATE_ID_TEST_RUN_DEPS_INSTALL = 'test-run-deps-install';
export const GATE_ID_TEST_RUN_PREFLIGHT = 'test-run-preflight';
export const GATE_ID_SDK_PATH_CONTRACT_HARD = 'sdk-path-contract-hard';
export const GATE_ID_TEST_RUN_CONTRACT_LINT = 'test-run-contract-lint';
export const GATE_ID_REQUIREMENTS_TXT_PREFLIGHT = 'requirements-txt-preflight';
export const GATE_ID_PYTHON_EXPORT_CONTRACT = 'python-export-contract';
export const GATE_ID_PYTHON_PYPI_SYMBOL = 'python-pypi-symbol';
export const GATE_ID_CHARTER_CONSTRAINT_WARN = 'charter-constraint-warn';
export const GATE_ID_MODULE_CONTRACT_TEST_WRITE = 'module-contract-test-write';
export const GATE_ID_TEST_QUALITY_TEST_WRITE = 'test-quality-test-write';
export const GATE_ID_BEHAVIOR_SPEC_TEST_WRITE = 'behavior-spec-test-write';
export const GATE_ID_PYTHON_DECLARED_DEPS_TEST_WRITE = 'python-declared-deps-test-write';
export const GATE_ID_MODULE_CONTRACT_POST_MUTATE = 'module-contract-post-mutate';
export const GATE_ID_PYTHON_EXPORT_CONTRACT_POST_IMPL = 'python-export-contract-post-impl';
export const GATE_ID_PYTHON_DECLARED_DEPS_POST_MUTATE = 'python-declared-deps-post-mutate';
export const GATE_ID_CONFIG_CONTRACT_POST_IMPL = 'config-contract-post-impl';
export const GATE_ID_PYTHON_REQUIREMENTS_MERGE = 'python-requirements-merge';
export const GATE_ID_PYTHON_PIP_RESYNC = 'python-pip-resync';
export const GATE_ID_PYTHON_DECLARED_DEPS_PRE_TEST_RUN = 'python-declared-deps-pre-test-run';
export const GATE_ID_SMOKE_DATA_BOOTSTRAP = 'smoke-data-bootstrap';

/** post-stage / workflow-end */
export const GATE_ID_POST_IMPL_STATIC_ANALYSIS = 'post-impl-static-analysis';
export const GATE_ID_DEMO_ARTIFACT_RUN = 'demo-artifact-run';
export const GATE_ID_RUN_END_CONTRACT_LINT = 'run-end-contract-lint';

/** 全部内置 gate id（测试与 debugEventForQualityGate 校验用）。 */
export const BUILTIN_QUALITY_GATE_IDS = [
  GATE_ID_SCHEMA_VALIDATION,
  GATE_ID_RULE20_VIOLATIONS,
  GATE_ID_PLAN_COMPLETENESS,
  GATE_ID_PLAN_COMPLETENESS_HARD,
  GATE_ID_GENERATOR_META_WARNINGS,
  GATE_ID_DEPENDENCY_GRAPH_WARNINGS,
  GATE_ID_COMPLEXITY_WARNINGS,
  GATE_ID_PROTOTYPE_DATA_CONTRACT,
  GATE_ID_STATIC_ANALYSIS_ON_GENERATE,
  GATE_ID_DEBUG_FEEDBACK_LOOP,
  GATE_ID_RED_GREEN_PRE_IMPL,
  GATE_ID_IMPL_WRITE_SCOPE,
  GATE_ID_PYTHON_VENV_BOOTSTRAP,
  GATE_ID_TEST_RUN_DEPS_INSTALL,
  GATE_ID_TEST_RUN_PREFLIGHT,
  GATE_ID_SDK_PATH_CONTRACT_HARD,
  GATE_ID_TEST_RUN_CONTRACT_LINT,
  GATE_ID_REQUIREMENTS_TXT_PREFLIGHT,
  GATE_ID_PYTHON_EXPORT_CONTRACT,
  GATE_ID_PYTHON_PYPI_SYMBOL,
  GATE_ID_POST_IMPL_STATIC_ANALYSIS,
  GATE_ID_CHARTER_CONSTRAINT_WARN,
  GATE_ID_MODULE_CONTRACT_TEST_WRITE,
  GATE_ID_TEST_QUALITY_TEST_WRITE,
  GATE_ID_BEHAVIOR_SPEC_TEST_WRITE,
  GATE_ID_PYTHON_DECLARED_DEPS_TEST_WRITE,
  GATE_ID_MODULE_CONTRACT_POST_MUTATE,
  GATE_ID_PYTHON_EXPORT_CONTRACT_POST_IMPL,
  GATE_ID_PYTHON_DECLARED_DEPS_POST_MUTATE,
  GATE_ID_CONFIG_CONTRACT_POST_IMPL,
  GATE_ID_PYTHON_REQUIREMENTS_MERGE,
  GATE_ID_PYTHON_PIP_RESYNC,
  GATE_ID_PYTHON_DECLARED_DEPS_PRE_TEST_RUN,
  GATE_ID_SMOKE_DATA_BOOTSTRAP,
  GATE_ID_DEMO_ARTIFACT_RUN,
  GATE_ID_RUN_END_CONTRACT_LINT,
] as const;

export type BuiltinQualityGateId = (typeof BUILTIN_QUALITY_GATE_IDS)[number];

const BUILTIN_GATE_ID_SET = new Set<string>(BUILTIN_QUALITY_GATE_IDS);

export function isBuiltinQualityGateId(gateId: string): gateId is BuiltinQualityGateId {
  return BUILTIN_GATE_ID_SET.has(gateId);
}
