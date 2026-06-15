import * as fs from 'node:fs'
import * as path from 'node:path'
import { createOpenAiHttpLlmModel } from './openai-http-llm.mjs'

/** Fast-feedback defaults: disable heavy preflight / context for speed. */
const FAST_CONFIG_DEFAULTS = {
  'plan.requireCompleteness': false,
  codebaseContextEnabled: false,
  experienceInjectOnGenerate: false,
  promptVersionsEnabled: false,
  staticAnalysisEnabled: false,
  enableRuntimeRule20Verify: false,
  llmMaxOutputTokens: 4096,
}

/**
 * @param {{
 *   workspace: string,
 *   globalDir: string,
 *   llm?: { apiKey: string, baseUrl: string, model: string, maxOutputTokens?: number },
 *   llmExtraModels?: Array<{ apiKey?: string, baseUrl?: string, model: string, maxOutputTokens?: number, usageRoles?: string[] }>,
 *   usageMeter?: { record(call: object): void },
 *   configOverrides?: Record<string, unknown>,
 *   onMessage?: (msg: unknown) => void,
 * }} opts
 */
export function createHeadlessPlatform(opts) {
  const state = new Map()
  const overrides = opts.configOverrides ?? {}
  const configStore = { ...FAST_CONFIG_DEFAULTS, ...overrides }
  if (opts.llm) {
    configStore.llmApiKey = opts.llm.apiKey
    configStore.llmBaseUrl = opts.llm.baseUrl
    configStore.llmModel = opts.llm.model
    if (!Object.prototype.hasOwnProperty.call(overrides, 'llmMaxOutputTokens')) {
      configStore.llmMaxOutputTokens = opts.llm.maxOutputTokens ?? 4096
    }
  }

  /** 注册模型表：主模型在前（无角色覆盖时 listModels 命中它）；额外模型供 llmModelByRole 路由。 */
  const llmModels = []
  if (opts.llm) {
    llmModels.push(
      createOpenAiHttpLlmModel({
        apiKey: opts.llm.apiKey,
        baseUrl: opts.llm.baseUrl,
        model: opts.llm.model,
        maxOutputTokens: opts.llm.maxOutputTokens ?? 4096,
        usageMeter: opts.usageMeter,
        usageRole: 'global',
      }),
    )
  }
  for (const extra of opts.llmExtraModels ?? []) {
    llmModels.push(
      createOpenAiHttpLlmModel({
        apiKey: extra.apiKey ?? opts.llm?.apiKey ?? '',
        baseUrl: extra.baseUrl ?? opts.llm?.baseUrl ?? '',
        model: extra.model,
        maxOutputTokens: extra.maxOutputTokens ?? opts.llm?.maxOutputTokens ?? 4096,
        usageMeter: opts.usageMeter,
        usageRole: extra.usageRoles?.join('+') ?? 'extra',
      }),
    )
  }

  return {
    config: {
      get(key, defaultValue) {
        if (key in configStore) {
          return configStore[key]
        }
        return defaultValue
      },
    },
    state: {
      get(key) {
        return state.get(key)
      },
      set(key, value) {
        if (value === undefined) {
          state.delete(key)
        } else {
          state.set(key, value)
        }
      },
      keys() {
        return [...state.keys()]
      },
    },
    paths: {
      globalStorageDir() {
        fs.mkdirSync(opts.globalDir, { recursive: true })
        return opts.globalDir
      },
      workspaceRoot() {
        return opts.workspace
      },
    },
    ui: {
      send(msg) {
        opts.onMessage?.(msg)
      },
      onMessage() {
        return { dispose() {} }
      },
    },
    notify: {
      info: async () => undefined,
      warn: async () => undefined,
      error: async () => undefined,
    },
    dialog: {
      pickDirectory: async () => undefined,
    },
    editor: {
      openFile: async () => {},
      openDiff: async () => {},
    },
    shell: {
      openExternal: async () => {},
      copyText: async () => {},
    },
    llm: {
      async listModels(filter) {
        if (llmModels.length === 0) {
          return []
        }
        const family = filter?.family?.trim()
        if (family) {
          return llmModels.filter((m) => m.family === family)
        }
        return [...llmModels]
      },
    },
  }
}

/**
 * Find artifact filenames under workspace root and/or instance task dir.
 * @param {string} workspace
 * @param {string[]} names
 * @param {string} [instanceKey]
 */
export function findArtifacts(workspace, names, instanceKey) {
  const dirs = [workspace]
  if (instanceKey) {
    dirs.push(path.join(workspace, '.stagent', 'instances', instanceKey))
  }
  const found = []
  for (const name of names) {
    if (dirs.some((d) => fs.existsSync(path.join(d, name)))) {
      found.push(name)
    }
  }
  return found
}

/**
 * @param {string} taskDir
 */
export function tailDebugLog(taskDir) {
  const p = path.join(taskDir, '.wf-debug.log')
  if (!fs.existsSync(p)) {
    return ''
  }
  const raw = fs.readFileSync(p, 'utf8')
  const lines = raw.trim().split('\n')
  return lines.slice(-12).join('\n')
}
