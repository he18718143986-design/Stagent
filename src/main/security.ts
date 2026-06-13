/* ------------------------------------------------------------------ */
/*  src/main/security.ts — URL / IPC validation helpers               */
/* ------------------------------------------------------------------ */

import type { SelectorChain, SelectorFields, SelectorStrategy } from './site-store'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SELECTOR_METHODS = new Set(['css', 'text', 'role', 'testid', 'xpath'] as const)
const OAUTH_HOST_PATTERNS = [
  /(^|\.)google\.com$/i,
  /(^|\.)apple\.com$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)microsoftonline\.com$/i,
  /(^|\.)live\.com$/i,
  /(^|\.)auth0\.com$/i,
  /(^|\.)okta\.com$/i,
  /(^|\.)workos\.com$/i,
  /(^|\.)clerk\.accounts\.dev$/i,
]

const MAX_LABEL_LEN = 80
const MAX_CHAT_TEXT_LEN = 20_000
const MAX_SELECTOR_LEN = 512
const MAX_SELECTOR_CHAIN_LEN = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

function parseUrl(raw: string, fieldName: string): URL {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`${fieldName} 不能为空`)
  try {
    return new URL(trimmed)
  } catch {
    throw new Error(`${fieldName} 不是合法 URL`)
  }
}

export function isAllowedSiteUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return true
  return false
}

function hasEmbeddedCredentials(url: URL): boolean {
  return Boolean(url.username || url.password)
}

export function assertSiteUrl(value: unknown, fieldName = 'url'): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`)
  const url = parseUrl(value, fieldName)
  if (hasEmbeddedCredentials(url)) {
    throw new Error(`${fieldName} 不允许包含用户名或密码`)
  }
  if (!isAllowedSiteUrl(url)) {
    throw new Error(`${fieldName} 仅支持 https，或本地调试用的 http://localhost`)
  }
  return url.toString()
}

export function canOpenExternally(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
  } catch {
    return false
  }
}

function isOAuthHost(hostname: string): boolean {
  return OAUTH_HOST_PATTERNS.some((pattern) => pattern.test(hostname))
}

export function shouldLoadPopupInApp(
  currentUrl: string,
  popupUrl: string,
  loginVisible: boolean,
): boolean {
  if (!loginVisible) return false
  try {
    const current = new URL(currentUrl)
    const popup = new URL(popupUrl)
    if (hasEmbeddedCredentials(popup) || !isAllowedSiteUrl(popup)) return false
    if (popup.origin === current.origin) return true
    return popup.protocol === 'https:' && isOAuthHost(popup.hostname)
  } catch {
    return false
  }
}

export function assertSiteId(value: unknown, fieldName = 'siteId'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new Error(`${fieldName} 不是合法 UUID`)
  }
  return value
}

export function normalizeOptionalLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('label 必须是字符串')
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_LABEL_LEN) {
    throw new Error(`label 长度不能超过 ${MAX_LABEL_LEN} 个字符`)
  }
  return trimmed
}

export function assertRenameLabel(value: unknown): string {
  const label = normalizeOptionalLabel(value)
  if (!label) throw new Error('label 不能为空')
  return label
}

export function assertChatText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('text 必须是字符串')
  const trimmed = value.trim()
  if (!trimmed) throw new Error('text 不能为空')
  if (trimmed.length > MAX_CHAT_TEXT_LEN) {
    throw new Error(`text 长度不能超过 ${MAX_CHAT_TEXT_LEN} 个字符`)
  }
  return trimmed
}

function assertSelectorString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`)
  if (value.length > MAX_SELECTOR_LEN) {
    throw new Error(`${fieldName} 长度不能超过 ${MAX_SELECTOR_LEN} 个字符`)
  }
  return value
}

function assertSelectorStrategy(value: unknown, fieldName: string): SelectorStrategy {
  if (!isRecord(value)) throw new Error(`${fieldName} 必须是对象`)
  const selector = assertSelectorString(value.selector, `${fieldName}.selector`)
  const trimmed = selector.trim()
  if (!trimmed) throw new Error(`${fieldName}.selector 不能为空`)
  if (typeof value.method !== 'string' || !SELECTOR_METHODS.has(value.method as SelectorStrategy['method'])) {
    throw new Error(`${fieldName}.method 不合法`)
  }
  if (!Number.isInteger(value.priority)) throw new Error(`${fieldName}.priority 必须是整数`)
  const failCount = value.failCount
  if (!Number.isInteger(failCount) || (failCount as number) < 0) {
    throw new Error(`${fieldName}.failCount 必须是非负整数`)
  }
  if (value.lastWorked !== undefined && typeof value.lastWorked !== 'string') {
    throw new Error(`${fieldName}.lastWorked 必须是字符串`)
  }
  return {
    selector: trimmed,
    method: value.method as SelectorStrategy['method'],
    priority: value.priority as number,
    failCount: failCount as number,
    ...(value.lastWorked !== undefined && { lastWorked: value.lastWorked }),
  }
}

function assertSelectorChain(value: unknown, fieldName: string): SelectorChain {
  if (!Array.isArray(value)) throw new Error(`${fieldName} 必须是数组`)
  if (value.length > MAX_SELECTOR_CHAIN_LEN) {
    throw new Error(`${fieldName} 长度不能超过 ${MAX_SELECTOR_CHAIN_LEN}`)
  }
  return value.map((item, index) => assertSelectorStrategy(item, `${fieldName}[${index}]`))
}

export function assertSelectorFields(value: unknown): SelectorFields {
  if (!isRecord(value)) throw new Error('selectors payload 必须是对象')

  const allowedKeys = new Set([
    'inputSelectors',
    'sendSelectors',
    'responseSelectors',
    'quotaExhaustedIndicator',
    'fileUploadTrigger',
  ])
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`不支持的 selector 字段: ${key}`)
  }

  const result: SelectorFields = {}
  if (value.inputSelectors !== undefined) result.inputSelectors = assertSelectorChain(value.inputSelectors, 'inputSelectors')
  if (value.sendSelectors !== undefined) result.sendSelectors = assertSelectorChain(value.sendSelectors, 'sendSelectors')
  if (value.responseSelectors !== undefined) result.responseSelectors = assertSelectorChain(value.responseSelectors, 'responseSelectors')
  if (value.quotaExhaustedIndicator !== undefined) {
    result.quotaExhaustedIndicator = assertSelectorString(value.quotaExhaustedIndicator, 'quotaExhaustedIndicator').trim()
  }
  if (value.fileUploadTrigger !== undefined) {
    result.fileUploadTrigger = assertSelectorString(value.fileUploadTrigger, 'fileUploadTrigger').trim()
  }
  return result
}

export function assertSelectorSource(value: unknown): 'detector' | 'user' {
  if (value === undefined) return 'user'
  if (value === 'detector' || value === 'user') return value
  throw new Error('source 必须是 detector 或 user')
}
