/**
 * Seeds a temp userData dir so Stagent runs against a mock "direct" OpenAI API.
 *
 * Writes two files the ElectronPlatformAdapter / WorkflowEngine read on startup:
 *   stagent/config.json — llmApiKey + llmBaseUrl (→ mock) + llmModel + workspace
 *   stagent/state.json  — pins the preferred model family to `direct:<model>` so
 *                         EVERY engine call (generation + each stage) goes to the
 *                         mock, never the local :8787 browser-adapter chain.
 *
 * Also creates an empty task workspace dir (where stage artifacts get written).
 */
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MOCK_MODEL_ID } from './mock-llm-server'

const PREFERRED_LM_STATE_KEY = 'stagent.preferredLanguageModelFamily'

export interface SeedStagentResult {
  workspacePath: string
}

export function seedStagentDirectApi(userDataDir: string, mockBaseUrl: string): SeedStagentResult {
  const stagentDir = join(userDataDir, 'stagent')
  mkdirSync(stagentDir, { recursive: true })

  const workspacePath = mkdtempSync(join(tmpdir(), 'stagent-ws-'))

  const config = {
    llmApiKey: 'mock-key',
    // ElectronLlmPort appends `/chat/completions` to this base URL.
    llmBaseUrl: `${mockBaseUrl}/v1`,
    llmModel: MOCK_MODEL_ID,
    llmMaxOutputTokens: 4096,
    taskWorkspacePath: workspacePath,
  }
  writeFileSync(join(stagentDir, 'config.json'), JSON.stringify(config, null, 2))

  const state = { [PREFERRED_LM_STATE_KEY]: `direct:${MOCK_MODEL_ID}` }
  writeFileSync(join(stagentDir, 'state.json'), JSON.stringify(state, null, 2))

  return { workspacePath }
}
