import type { Stage } from './WorkflowDefinition';

export type AgentRole = 'decision' | 'implementation' | 'test-write' | 'lightweight' | 'default';

export const AGENT_ROLES: readonly AgentRole[] = [
  'decision',
  'implementation',
  'test-write',
  'lightweight',
  'default',
];

export interface AgentSelectionConfig {
  preferredModelByRole?: Partial<Record<AgentRole, string>>;
  fallbackToDefault: boolean;
}

export interface LanguageModelLike {
  family: string;
  name: string;
  id: string;
}

/**
 * 仅凭 stage(trace) id 前缀分类角色（执行链只持有 traceStageId 字符串时使用）。
 * trace id 可能带组合后缀（如 `stage_test_run_x:gate-repair`），前缀匹配天然兼容——
 * 非 test_write / impl 前缀（含 test_run 派生的 fix/gate-repair 调用）一律走 default，
 * 即沿用全局 preferredModelFamily，不会误用 test-write 专属模型。
 */
export function classifyStageRoleFromId(stageId: string): AgentRole {
  if (/^stage_decide_/.test(stageId)) {
    return 'decision';
  }
  if (/^stage_test_write_/.test(stageId)) {
    return 'test-write';
  }
  if (/^stage_impl_/.test(stageId)) {
    return 'implementation';
  }
  if (/^stage_(zoom|doc|polish|summary)/.test(stageId)) {
    return 'lightweight';
  }
  return 'default';
}

export function classifyStageRole(stage: Stage): AgentRole {
  if (stage.isDecisionStage) {
    return 'decision';
  }
  return classifyStageRoleFromId(stage.id);
}

/**
 * 由 stage(trace) id + 角色覆盖表解析模型 family hint。
 * 未配置该角色（或值为空）返回 undefined → 调用方回退全局 preferredModelFamily。
 */
export function modelFamilyHintForStageId(
  stageId: string,
  overrides: Partial<Record<AgentRole, string>>,
): string | undefined {
  const role = classifyStageRoleFromId(stageId);
  const v = overrides[role]?.trim();
  return v || undefined;
}

function resolveModelFamilyOverride(
  role: AgentRole,
  overrides: Partial<Record<AgentRole, string>>,
): string | undefined {
  const direct = overrides[role]?.trim();
  if (direct) {
    return direct;
  }
  const fallback = overrides.default?.trim();
  return fallback || undefined;
}

function modelMatchesHint(model: LanguageModelLike, hint: string): boolean {
  const h = hint.trim();
  if (!h) {
    return false;
  }
  if (model.family === h || model.name === h || model.id === h) {
    return true;
  }
  if (h.startsWith('direct:')) {
    const modelName = h.slice('direct:'.length);
    return (
      model.family === h ||
      model.name === h ||
      (model.family.startsWith('direct:') && model.family.slice('direct:'.length) === modelName)
    );
  }
  return model.family.includes(h) || model.name.includes(h);
}

/** 从可用模型列表中按角色 overrides 选取；纯函数，便于单测。 */
export function pickModelForStage<T extends LanguageModelLike>(
  stage: Stage,
  config: AgentSelectionConfig,
  availableModels: T[],
): T | undefined {
  if (availableModels.length === 0) {
    return undefined;
  }
  const role = classifyStageRole(stage);
  const hint = resolveModelFamilyOverride(role, config.preferredModelByRole ?? {});
  if (hint) {
    const matched = availableModels.find((m) => modelMatchesHint(m, hint));
    if (matched) {
      return matched;
    }
  }
  return config.fallbackToDefault ? availableModels[0] : undefined;
}

export function buildAgentSelectionConfig(
  overrides: Partial<Record<string, string>>,
  fallbackToDefault = true,
): AgentSelectionConfig {
  const preferredModelByRole: Partial<Record<AgentRole, string>> = {};
  for (const role of AGENT_ROLES) {
    const v = overrides[role]?.trim();
    if (v) {
      preferredModelByRole[role] = v;
    }
  }
  return { preferredModelByRole, fallbackToDefault };
}
