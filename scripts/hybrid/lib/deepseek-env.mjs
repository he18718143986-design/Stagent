/**
 * DeepSeek / 大陆 OpenAI 兼容端点默认 env（deliver / hybrid live）。
 */
import * as fs from 'node:fs'

/**
 * @param {{ requireKey?: boolean }} opts
 * @returns {{ ok: boolean, error?: string }}
 */
export function applyDeepSeekDefaults(opts = {}) {
  const { requireKey = false } = opts

  if (!process.env.LLM_MODEL) {
    process.env.LLM_MODEL = 'deepseek/deepseek-chat'
  }
  if (!process.env.LLM_BASE_URL) {
    process.env.LLM_BASE_URL = 'https://api.deepseek.com/v1'
  }
  if (!process.env.OPENHANDS_SUPPRESS_BANNER) {
    process.env.OPENHANDS_SUPPRESS_BANNER = '1'
  }

  const key = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY
  if (key && !process.env.LLM_API_KEY) {
    process.env.LLM_API_KEY = key
  }
  if (requireKey && !key) {
    return {
      ok: false,
      error:
        '缺少 DEEPSEEK_API_KEY（或 LLM_API_KEY）。请在 .env.local 或环境中配置 DeepSeek 密钥。',
    }
  }
  return { ok: true }
}

/**
 * @param {string} venvCli
 */
export function assertCodeActVenv(venvCli) {
  if (!fs.existsSync(venvCli)) {
    return {
      ok: false,
      error: 'CodeAct venv 未安装。请先运行：npm run codeact:install',
    }
  }
  return { ok: true }
}
