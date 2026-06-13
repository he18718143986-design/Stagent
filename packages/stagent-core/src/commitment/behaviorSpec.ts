import type { Stage, StageRuntime } from '../WorkflowDefinition';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { coerceDecisionArtifacts } from '../python-contract/ModuleContractLint';
import { BEHAVIOR_SPEC_SLICE_SUFFIX } from './parseDecisionArtifacts';
import {
  decideStageIdFromSemanticName,
  GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
  isDecideStageId,
  isImplStageId,
  isTestWriteStageId,
  semanticNameFromDecideStageId,
} from '../workflow/StageIdPatterns';
import { BEHAVIOR_SPEC_REQUIRED_SLICES } from './behaviorSpecSchema';
import { semanticFromRuntimeReplanTestFixStageId } from '../runtime-replan/constants';
import {
  semanticFromFixIfFailedStageId,
  semanticFromRuntimeReplanImplFixStageId,
} from '../runtime-replan/FixExhaustedRouter';
import {
  type BehaviorSpecV1,
  isBehaviorSpecV1,
  normalizeBehaviorSpec,
} from './behaviorSpecSchema';

export type BehaviorSpecConsumerMode = 'test_write' | 'impl' | 'fix' | 'testfix';

/**
 * 切片 decide 运行时后缀（覆盖语义填充后的 systemPrompt，防 BEHAVIOR_SPEC 被冲掉）。
 */
export function buildBehaviorSpecDecidePromptSuffix(stageId: string, systemPrompt: string): string | undefined {
  if (!isDecideStageId(stageId) || stageId === GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID) {
    return undefined;
  }
  const semantic = semanticNameFromDecideStageId(stageId);
  if (!semantic || !(BEHAVIOR_SPEC_REQUIRED_SLICES as readonly string[]).includes(semantic)) {
    return undefined;
  }
  if (systemPrompt.includes('decisionArtifacts.behaviorSpec')) {
    return undefined;
  }
  return BEHAVIOR_SPEC_SLICE_SUFFIX.trim();
}

function resolveSliceBehaviorSpec(
  runtimes: StageRuntime[],
  semantic: string,
): BehaviorSpecV1 | null {
  const decideId = decideStageIdFromSemanticName(semantic);
  const sliceRt = runtimes.find((r) => r.stageId === decideId);
  const artifacts = coerceDecisionArtifacts(sliceRt?.outputs?.[DECISION_ARTIFACTS_OUTPUT_KEY]);
  const raw = artifacts?.behaviorSpec;
  if (!isBehaviorSpecV1(raw)) {
    return null;
  }
  return normalizeBehaviorSpec(raw);
}

function formatConditionsBlock(spec: BehaviorSpecV1, mode: BehaviorSpecConsumerMode): string[] {
  const lines: string[] = [];
  for (const fn of spec.functions) {
    const combiner = fn.when_non_null === 'any' ? 'OR' : 'AND';
    lines.push(`- ${fn.name}() → ${fn.returns}；非 null 当且仅当下列条件 ${combiner} 满足：`);
    for (const c of fn.conditions) {
      lines.push(`  · [${c.id}] ${c.desc}`);
    }
  }
  if (spec.edge_rules.length > 0) {
    lines.push('- edge_rules（全链路纪律，冲突时以本表为准）：');
    for (const r of spec.edge_rules) {
      lines.push(`  · ${r}`);
    }
  }
  if (spec.fixture_hints?.length) {
    lines.push('- fixture_hints：');
    for (const h of spec.fixture_hints) {
      lines.push(`  · ${h}`);
    }
  }
  if (mode === 'test_write') {
    lines.push(
      '- test_write：每个 condition id 至少一条行为级断言；禁止仅 `is not None`；禁止 sys.modules 劫持。',
    );
  } else if (mode === 'impl') {
    lines.push(
      '- impl：逐条实现 conditions；返回 None 当任一 AND 子条件不满足（when_non_null=all）。',
    );
  } else {
    lines.push('- fix/testfix：对齐已落盘 test 与下列 conditions；禁止改 test 文件名与 condition id 语义。');
  }
  return lines;
}

/**
 * 运行时注入 test_write / impl / fix / testfix：decide 机读 behaviorSpec SSOT。
 */
export function buildBehaviorSpecPromptSuffix(
  runtimes: StageRuntime[],
  stage: Stage,
  mode: BehaviorSpecConsumerMode,
): string | undefined {
  let semantic: string | undefined;
  if (mode === 'testfix') {
    semantic = semanticFromRuntimeReplanTestFixStageId(stage.id);
  } else if (mode === 'fix') {
    semantic =
      semanticFromFixIfFailedStageId(stage.id) ??
      semanticFromRuntimeReplanImplFixStageId(stage.id);
  } else if (isTestWriteStageId(stage.id) || isImplStageId(stage.id)) {
    semantic = stage.id.replace(/^stage_(?:test_write|impl)_/, '');
  }
  if (!semantic) {
    return undefined;
  }
  const spec = resolveSliceBehaviorSpec(runtimes, semantic);
  if (!spec) {
    return undefined;
  }
  return [
    '【行为规格 SSOT（decisionArtifacts.behaviorSpec · 运行时）】',
    `模块 ${spec.module}；散文 DecisionRecord 与下列机读规格冲突时，以 behaviorSpec 为准。`,
    ...formatConditionsBlock(spec, mode),
  ].join('\n');
}

/** fix 路由：用 behaviorSpec 替换分散 CCI/MA 散文补丁（Run #50 类失败）。 */
export function buildBehaviorSpecFixHints(
  runtimes: StageRuntime[],
  semantic: string | undefined,
): string[] {
  if (!semantic) {
    return [];
  }
  const spec = resolveSliceBehaviorSpec(runtimes, semantic);
  if (!spec) {
    return [];
  }
  const lines = [
    '- behaviorSpec SSOT：下列 condition id 为 impl 对齐基准（禁止改 test）：',
  ];
  for (const fn of spec.functions) {
    const combiner = fn.when_non_null === 'any' ? 'OR' : 'AND';
    lines.push(`  · ${fn.name}：${combiner} 链 → ${fn.conditions.map((c) => c.id).join(', ')}`);
  }
  for (const r of spec.edge_rules) {
    lines.push(`  · edge: ${r}`);
  }
  return lines;
}

export { resolveSliceBehaviorSpec };
