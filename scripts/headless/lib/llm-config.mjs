import { normalizeLlmBaseUrl } from './normalize-base-url.mjs'

/**
 * Per-role LLM env（ADR-0006）。各角色独立可选；未设则该角色回退全局 LLM_MODEL。
 * test-write 的 baseUrl/apiKey 同时接受历史名 LLM_BASE_URL_TEST_WRITE / LLM_API_KEY_TEST_WRITE。
 */
export const ROLE_LLM_ENV = [
  {
    role: 'decision',
    modelKey: 'LLM_MODEL_DECISION',
    baseUrlKeys: ['LLM_MODEL_DECISION_BASE_URL'],
    apiKeyKeys: ['LLM_MODEL_DECISION_API_KEY'],
  },
  {
    role: 'test-write',
    modelKey: 'LLM_MODEL_TEST_WRITE',
    baseUrlKeys: ['LLM_MODEL_TEST_WRITE_BASE_URL', 'LLM_BASE_URL_TEST_WRITE'],
    apiKeyKeys: ['LLM_MODEL_TEST_WRITE_API_KEY', 'LLM_API_KEY_TEST_WRITE'],
  },
  {
    role: 'integration',
    modelKey: 'LLM_MODEL_INTEGRATION',
    baseUrlKeys: ['LLM_MODEL_INTEGRATION_BASE_URL'],
    apiKeyKeys: ['LLM_MODEL_INTEGRATION_API_KEY'],
  },
]

/** @param {Record<string, string | undefined>} env */
function firstEnv(env, keys) {
  for (const key of keys) {
    const val = (env[key] ?? '').trim()
    if (val) {
      return val
    }
  }
  return ''
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ apiKey: string, baseUrl: string, maxOutputTokens: number }} primary
 */
export function parseRoleModels(env, primary) {
  /** @type {Record<string, { model: string, baseUrl: string, apiKey: string, maxOutputTokens: number }>} */
  const roleModels = {}
  for (const spec of ROLE_LLM_ENV) {
    const model = (env[spec.modelKey] ?? '').trim()
    if (!model) {
      continue
    }
    const baseUrlRaw = firstEnv(env, spec.baseUrlKeys)
    const apiKeyRaw = firstEnv(env, spec.apiKeyKeys)
    roleModels[spec.role] = {
      model,
      baseUrl: baseUrlRaw ? normalizeLlmBaseUrl(baseUrlRaw) : primary.baseUrl,
      apiKey: apiKeyRaw || primary.apiKey,
      maxOutputTokens: primary.maxOutputTokens,
    }
  }
  return roleModels
}

/**
 * @param {{ live: boolean, mockUrl?: string, mockModel?: string }} ctx
 * @param {Record<string, string | undefined>} [env]
 * @param {{ liveMaxOutputTokens?: number }} [opts]
 */
export function buildLlmConfig(ctx, env = process.env, opts = {}) {
  const liveMaxOutputTokens = opts.liveMaxOutputTokens ?? 16_384
  if (ctx.live) {
    const apiKey = (env.DEEPSEEK_API_KEY ?? env.LLM_API_KEY ?? '').trim()
    if (!apiKey) {
      throw new Error('live mode requires DEEPSEEK_API_KEY or LLM_API_KEY')
    }
    const baseUrl = normalizeLlmBaseUrl(env.LLM_BASE_URL ?? 'https://api.deepseek.com')
    const model = (env.LLM_MODEL ?? 'deepseek-chat').trim()
    const primary = {
      apiKey,
      baseUrl,
      model,
      maxOutputTokens: liveMaxOutputTokens,
    }
    const roleModels = parseRoleModels(env, primary)
    return {
      apiKey,
      baseUrl,
      model,
      maxOutputTokens: liveMaxOutputTokens,
      ...(Object.keys(roleModels).length > 0 ? { roleModels } : {}),
    }
  }
  if (!ctx.mockUrl) {
    throw new Error('mockUrl required for mock mode')
  }
  return {
    apiKey: 'mock-key',
    baseUrl: `${ctx.mockUrl}/v1`,
    model: ctx.mockModel ?? 'mock-model',
    maxOutputTokens: 4096,
  }
}

/** 同一 endpoint 的额外模型只注册一次（family = direct:<model>）。 */
function extraModelKey(cfg) {
  return `${cfg.model}\0${cfg.baseUrl}\0${cfg.apiKey}`
}

/**
 * 由 buildLlmConfig 的 roleModels 构造 llmModelByRole 与 llmExtraModels（ADR-0006 PR-3 接线）。
 * @param {{ model: string, roleModels?: Record<string, { model: string, baseUrl: string, apiKey: string, maxOutputTokens?: number }> }} llm
 */
export function buildRoleModelRouting(llm) {
  const roleModels = llm.roleModels ?? {}
  const entries = Object.entries(roleModels)
  if (entries.length === 0) {
    return { roleOverrides: undefined, llmExtraModels: undefined, roleUsageLabels: {} }
  }

  /** @type {Record<string, string>} */
  const llmModelByRole = {}
  /** @type {Array<{ model: string, baseUrl: string, apiKey: string, maxOutputTokens?: number, usageRoles: string[] }>} */
  const extras = []
  /** @type {Map<string, number>} */
  const extraIndex = new Map()
  /** @type {Record<string, string>} */
  const roleUsageLabels = {}

  for (const [role, cfg] of entries) {
    llmModelByRole[role] = `direct:${cfg.model}`
    roleUsageLabels[role] = cfg.model
    const key = extraModelKey(cfg)
    if (cfg.model === llm.model) {
      continue
    }
    const idx = extraIndex.get(key)
    if (idx === undefined) {
      extraIndex.set(key, extras.length)
      extras.push({
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        maxOutputTokens: cfg.maxOutputTokens,
        usageRoles: [role],
      })
    } else {
      extras[idx].usageRoles.push(role)
    }
  }

  return {
    roleOverrides: { llmModelByRole },
    llmExtraModels: extras.length > 0 ? extras : undefined,
    roleUsageLabels,
  }
}
