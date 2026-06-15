import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { buildLlmConfig, buildRoleModelRouting, parseRoleModels } from './llm-config.mjs'

const LIVE_CTX = { live: true }

function liveEnv(overrides = {}) {
  return {
    DEEPSEEK_API_KEY: 'sk-test',
    LLM_BASE_URL: 'https://api.deepseek.com',
    LLM_MODEL: 'deepseek-v4-flash',
    ...overrides,
  }
}

test('buildLlmConfig: only LLM_MODEL → no roleModels (零配置回归)', () => {
  const llm = buildLlmConfig(LIVE_CTX, liveEnv())
  assert.equal(llm.model, 'deepseek-v4-flash')
  assert.equal(llm.roleModels, undefined)
  assert.deepEqual(buildRoleModelRouting(llm), {
    roleOverrides: undefined,
    llmExtraModels: undefined,
    roleUsageLabels: {},
  })
})

test('buildLlmConfig: LLM_MODEL_DECISION only routes decision role', () => {
  const llm = buildLlmConfig(
    LIVE_CTX,
    liveEnv({ LLM_MODEL_DECISION: 'deepseek-v4-pro' }),
  )
  assert.equal(llm.roleModels?.decision?.model, 'deepseek-v4-pro')
  assert.equal(llm.roleModels?.['test-write'], undefined)
  assert.equal(llm.roleModels?.integration, undefined)

  const routing = buildRoleModelRouting(llm)
  assert.deepEqual(routing.roleOverrides?.llmModelByRole, {
    decision: 'direct:deepseek-v4-pro',
  })
  assert.equal(routing.llmExtraModels?.length, 1)
  assert.equal(routing.llmExtraModels[0].model, 'deepseek-v4-pro')
})

test('buildLlmConfig: LLM_MODEL_TEST_WRITE only routes test-write (不再连带 decision/integration)', () => {
  const llm = buildLlmConfig(
    LIVE_CTX,
    liveEnv({ LLM_MODEL_TEST_WRITE: 'deepseek-v4-pro' }),
  )
  assert.equal(llm.roleModels?.['test-write']?.model, 'deepseek-v4-pro')
  assert.equal(llm.roleModels?.decision, undefined)
  assert.equal(llm.roleModels?.integration, undefined)

  const routing = buildRoleModelRouting(llm)
  assert.deepEqual(routing.roleOverrides?.llmModelByRole, {
    'test-write': 'direct:deepseek-v4-pro',
  })
})

test('buildLlmConfig: per-role baseUrl/apiKey + legacy test-write env names', () => {
  const llm = buildLlmConfig(
    LIVE_CTX,
    liveEnv({
      LLM_MODEL_DECISION: 'pro-a',
      LLM_MODEL_DECISION_BASE_URL: 'https://decision.example/v1/',
      LLM_MODEL_DECISION_API_KEY: 'key-decision',
      LLM_MODEL_TEST_WRITE: 'pro-b',
      LLM_BASE_URL_TEST_WRITE: 'https://testwrite.example',
      LLM_API_KEY_TEST_WRITE: 'key-tw',
      LLM_MODEL_INTEGRATION: 'pro-c',
    }),
  )
  assert.equal(llm.roleModels.decision.baseUrl, 'https://decision.example/v1')
  assert.equal(llm.roleModels.decision.apiKey, 'key-decision')
  assert.equal(llm.roleModels['test-write'].baseUrl, 'https://testwrite.example/v1')
  assert.equal(llm.roleModels['test-write'].apiKey, 'key-tw')
  assert.equal(llm.roleModels.integration.model, 'pro-c')
  assert.equal(llm.roleModels.integration.baseUrl, 'https://api.deepseek.com/v1')
})

test('buildRoleModelRouting dedupes same model endpoint for multiple roles', () => {
  const llm = {
    model: 'flash',
    roleModels: {
      decision: { model: 'pro', baseUrl: 'https://api.example/v1', apiKey: 'k' },
      integration: { model: 'pro', baseUrl: 'https://api.example/v1', apiKey: 'k' },
      'test-write': { model: 'writer', baseUrl: 'https://api.example/v1', apiKey: 'k' },
    },
  }
  const routing = buildRoleModelRouting(llm)
  assert.deepEqual(routing.roleOverrides?.llmModelByRole, {
    decision: 'direct:pro',
    integration: 'direct:pro',
    'test-write': 'direct:writer',
  })
  assert.equal(routing.llmExtraModels?.length, 2)
  const proExtra = routing.llmExtraModels.find((m) => m.model === 'pro')
  assert.deepEqual(proExtra?.usageRoles.sort(), ['decision', 'integration'])
})

test('buildRoleModelRouting skips extra registration when role model equals global', () => {
  const llm = {
    model: 'flash',
    roleModels: {
      'test-write': { model: 'flash', baseUrl: 'https://api.example/v1', apiKey: 'k' },
    },
  }
  const routing = buildRoleModelRouting(llm)
  assert.deepEqual(routing.roleOverrides?.llmModelByRole, { 'test-write': 'direct:flash' })
  assert.equal(routing.llmExtraModels, undefined)
})

test('parseRoleModels returns empty when no role env set', () => {
  assert.deepEqual(
    parseRoleModels(liveEnv(), { apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1', maxOutputTokens: 4096 }),
    {},
  )
})
