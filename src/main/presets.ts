/* ------------------------------------------------------------------ */
/*  src/main/presets.ts — Built-in selector presets (priority 5)      */
/*                                                                      */
/*  These are shipped with the app and validated against each site's   */
/*  current DOM. Users who manually calibrate (priority 10) or whose   */
/*  auto-detector writes (priority 3) are never affected by this file. */
/*                                                                      */
/*  To add a new site: append an entry to PRESETS and add the          */
/*  corresponding card to PRESET_CATALOG in ResourcesPage.tsx.         */
/* ------------------------------------------------------------------ */

import type { SelectorChain, ModelOption, ToolToggle, EffortLevel } from './site-store'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Measured free-tier capability matrix for a site, captured by hand against the
 * live logged-in UI. This documents what a *free* account can actually do
 * in-page (which the automation layer can / cannot currently drive). It is
 * descriptive metadata only — toggling these tools is NOT yet automated
 * (see §"feasibility" notes below and chat:switch-model in ipc.ts).
 */
export interface FreeTierCapabilities {
  /** Date the matrix was verified against the live free-tier UI (YYYY-MM-DD). */
  verifiedAt: string
  /** Free tier can pick between ≥2 models from the in-page model dropdown. */
  modelSwitch: boolean
  /** Composer supports uploading files / images. */
  fileUpload: boolean
  /** Has a web / online search toggle. */
  webSearch: boolean
  /** Has an extended reasoning / "think" toggle. */
  deepThink: boolean
  /** Has a multi-step deep-research mode. */
  deepResearch: boolean
  /** Can generate images in-chat. */
  imageGen: boolean
  /** Can generate audio / music in-chat. */
  audioGen: boolean
  /** Free-form notes (zh ok): how a capability is toggled, quirks, caveats. */
  notes?: string
}

export interface SitePreset {
  hostname: string
  label: string
  url: string
  inputSelectors: SelectorChain
  sendSelectors: SelectorChain
  responseSelectors: SelectorChain
  /** CSS selector or `text=<substring>` that appears when the free quota is exhausted */
  quotaExhaustedIndicator?: string
  /**
   * URL pattern that matches the post-login chat page.
   * Used as the primary login-detection signal: when the WebContentsView
   * navigates to a URL matching this pattern, login is immediately confirmed
   * without waiting for a DOM selector check.
   * ⚠️ Patterns must be validated against real post-login URLs and must NOT
   * match OAuth intermediate pages (login/auth/accounts etc.).
   */
  loggedInUrlPattern?: RegExp
  /** Selector for the button that opens the model picker dropdown. */
  modelSwitcherSelector?: string
  /** Known models available on this site (from presets; user can override via Selector Debugger). */
  availableModels?: ModelOption[]
  /** §2.3-bis: URL pattern (regex string) for the SSE/streaming response. */
  ssePattern?: string
  /** §2.3-bis: JS function body for extracting incremental text from one SSE data line.
   *  Receives: line (raw SSE data value, without "data: " prefix).
   *  Returns: string chunk | null. */
  sseDataExtractor?: string
  /** Measured free-tier capability matrix (descriptive; see FreeTierCapabilities). */
  freeTierCapabilities?: FreeTierCapabilities
  /** M12: One-click composer tools that chat:toggle-tool can drive (see ToolToggle). */
  toolToggles?: ToolToggle[]
  /** M13: Reasoning-effort tiers selectable as resource-pool variants (::effort=<id>). */
  effortLevels?: EffortLevel[]
  /** M13: Submenu trigger (inside the model picker) that reveals the effort tiers. */
  effortMenuTriggerSelector?: string
}

// ─── Preset data ─────────────────────────────────────────────────────────────

export const PRESETS: SitePreset[] = [
  {
    hostname: 'chatgpt.com',
    label: 'ChatGPT',
    url: 'https://chatgpt.com',
    // Post-login URLs: new chat at root, existing chats at /c/<id>
    // ⚠️ Validate against real ChatGPT URLs; auth pages are auth.openai.com / chatgpt.com/auth
    loggedInUrlPattern: /^https:\/\/chatgpt\.com\/(c\/|$|#|\?)/,
    inputSelectors: [
      { selector: '#prompt-textarea', method: 'css', priority: 5, failCount: 0 },
      { selector: '[data-id="root"] [role="textbox"]', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: '[data-testid="send-button"]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      // Inner prose container first — contains only the response text.
      // [data-message-author-role="assistant"] wraps the whole turn including
      // the "ChatGPT 说：" author label, so it must be lowest priority (fallback).
      { selector: 'div.markdown.prose', method: 'css', priority: 5, failCount: 0 },
      { selector: 'div[class*="prose"]', method: 'css', priority: 4, failCount: 0 },
      { selector: 'article[data-testid*="conversation-turn"]', method: 'css', priority: 3, failCount: 0 },
      { selector: '[data-testid*="conversation-turn"]', method: 'css', priority: 2, failCount: 0 },
      { selector: 'div[class*="agent-turn"]', method: 'css', priority: 2, failCount: 0 },
      // Broad turn container — includes author label, used only as last resort
      { selector: '[data-message-author-role="assistant"]', method: 'css', priority: 1, failCount: 0 },
    ],
    quotaExhaustedIndicator: "text=You've reached your free limit||text=You've reached your limit||text=You've reached the usage cap||text=upgrade to continue",
    // The model selector button (observed aria-label "模型选择器" on the zh UI).
    modelSwitcherSelector: 'button[aria-label="模型选择器"], button[aria-label*="model" i], button[data-testid*="model" i]',
    // Free tier (verified 2026-05-30): the picker only offers one selectable
    // model ("ChatGPT" / 适合日常任务) plus a "ChatGPT Plus 升级" upsell — i.e. no
    // real free model switching. The picker UI hides itself when this list is
    // empty (see ModelPicker.tsx). GPT-4o/o-series switching requires Plus.
    availableModels: [],
    freeTierCapabilities: {
      verifiedAt: '2026-05-30',
      modelSwitch: false,
      fileUpload: true,
      webSearch: true,
      deepThink: true,
      deepResearch: true,
      imageGen: true,
      audioGen: false,
      notes:
        '免费版模型不可切换（仅“ChatGPT”自动档，另一项为“ChatGPT Plus 升级”）。' +
        '输入框“+”菜单：添加照片和文件、创建图片、思考一下（深度思考）、深度研究、网页搜索。',
    },
    // M12: ChatGPT's tools live inside the composer "+" menu, so each toggle
    // opens that menu first (menuTriggerSelector) and then clicks the item by
    // its visible text. These menu items don't expose a persistent aria-pressed
    // state, so they are best-effort "enable" actions (see tool-toggle.ts).
    toolToggles: [
      { id: 'webSearch',    label: '网页搜索', menuTriggerSelector: 'button[aria-label="添加文件等"]', selector: 'text=网页搜索' },
      { id: 'deepThink',    label: '思考一下', menuTriggerSelector: 'button[aria-label="添加文件等"]', selector: 'text=思考一下' },
      { id: 'deepResearch', label: '深度研究', menuTriggerSelector: 'button[aria-label="添加文件等"]', selector: 'text=深度研究' },
    ],
    // §2.3-bis: ChatGPT streams responses as SSE on /backend-api/conversation (+variants).
    // Exclude `/backend-api/conversations` (JSON list) and `/conversation/init` so fetch/CDP
    // taps don't latch onto JSON responses; extractor/parsers gate usable assistant text.
    ssePattern:
      '\\/backend-api\\/conversation(?!s)(?!\\/init)|\\/backend-api\\/f\\/[^/]+\\/conversation',
    sseDataExtractor: [
      'if (line === "[DONE]") return null;',
      'try {',
      '  var d = JSON.parse(line);',
      '  if (d && typeof d.v === "string") return d.v;',
      '  return null;',
      '} catch (_) { return null; }',
    ].join(' '),
  },
  {
    hostname: 'claude.ai',
    label: 'Claude',
    url: 'https://claude.ai',
    // Post-login URLs: /new (new chat), /chat/<id> (existing chat)
    // ⚠️ claude.ai/login is the login page; claude.ai/api/... are API routes (not login)
    loggedInUrlPattern: /^https:\/\/claude\.ai\/(new|chat\/)/,
    inputSelectors: [
      { selector: '[contenteditable="true"][data-placeholder]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'div[contenteditable="true"]', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'button[type="submit"]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      // Innermost prose containers are checked FIRST (highest priority) so that
      // when Claude's Extended Thinking is enabled, the thinking-block wrapper
      // (.font-claude-message, which includes "Thought process" text) is never
      // returned in favour of the actual response content inside .prose.
      { selector: '.font-claude-message .prose', method: 'css', priority: 7, failCount: 0 },
      { selector: '.contents .prose', method: 'css', priority: 6, failCount: 0 },
      { selector: '.prose', method: 'css', priority: 5, failCount: 0 },
      { selector: '[data-is-streaming]', method: 'css', priority: 4, failCount: 0 },
      // Broad containers below — only used as fallback when no prose div exists yet
      { selector: '.font-claude-message', method: 'css', priority: 3, failCount: 0 },
      { selector: '[class*="claude-message"]', method: 'css', priority: 2, failCount: 0 },
    ],
    quotaExhaustedIndicator: "text=You've hit your free plan limit||text=You've reached your usage limit||text=You've reached your plan's usage cap||text=Upgrade to continue",
    // Verified 2026-05-30 against the live logged-in (free) UI. The model picker
    // button carries aria-label "Model: <name> <effort>" (e.g. "Model: Sonnet 4.6 Max").
    modelSwitcherSelector: 'button[aria-label^="Model:"], button[data-testid="model-selector-dropdown"], button[aria-label*="model" i]',
    // Free tier (verified 2026-05-30): only Sonnet 4.6 and Haiku 4.5 are
    // selectable; Opus 4.8 / 4.7 / 4.6 / 3 all carry an "Upgrade" gate, so they
    // are intentionally excluded from the switchable pool. Labels match the
    // in-menu text exactly (switch path matches by innerText.includes(label)).
    availableModels: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
    ],
    // M13: reasoning-effort tiers live in an "Effort" submenu inside the model
    // picker (verified 2026-05-30: Low(默认)/Medium/High/Max). Selectable in the
    // resource pool as <siteId>::effort=<id>; applyEffort opens the model picker
    // (modelSwitcherSelector), then the "Effort" submenu, then clicks the tier.
    effortMenuTriggerSelector: 'text=Effort',
    effortLevels: [
      { id: 'low',    label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high',   label: 'High' },
      { id: 'max',    label: 'Max' },
    ],
    freeTierCapabilities: {
      verifiedAt: '2026-05-30',
      modelSwitch: true,
      fileUpload: true,
      webSearch: true,
      deepThink: true,
      deepResearch: false,
      imageGen: false,
      audioGen: false,
      notes:
        '免费版可切 Sonnet 4.6 / Haiku 4.5（Opus 全系需升级）。模型选择器内含 ' +
        '“Effort 思考强度”子菜单：Low(默认)/Medium/High/Max，等价于“深度思考”强度调节，' +
        '但为单选档位而非布尔开关，未做成 toolToggle。输入框“+”菜单含：添加照片和文件、' +
        '截图、添加到项目、从 GitHub 添加、Skills、连接器、插件、Web search（联网搜索，可勾选）、Use style。',
    },
    // M12: Claude's "Web search" lives inside the composer "+" menu as a
    // menuitemcheckbox (aria-checked), so the toggle opens that menu first then
    // clicks the item by text — readState() picks up aria-checked for idempotency.
    toolToggles: [
      {
        id: 'webSearch',
        label: 'Web search',
        menuTriggerSelector: 'button[aria-label="Add files, connectors, and more"]',
        selector: 'text=Web search',
      },
    ],
    // §2.3-bis: Claude streams responses as SSE on the /completion endpoint.
    // Each data line with type "content_block_delta" carries an incremental text delta.
    ssePattern: '\\/api\\/organizations\\/[^\\/]+\\/chat_conversations\\/[^\\/]+\\/completion',
    sseDataExtractor: [
      'try {',
      '  var d = JSON.parse(line);',
      '  if (d && d.type === "content_block_delta" && d.delta && typeof d.delta.text === "string") {',
      '    return d.delta.text;',
      '  }',
      '  return null;',
      '} catch (_) { return null; }',
    ].join(' '),
  },
  {
    hostname: 'gemini.google.com',
    label: 'Gemini',
    url: 'https://gemini.google.com',
    // Post-login URL: /app (main Gemini UI after Google login)
    // ⚠️ accounts.google.com is the auth page — must not be confused with logged-in state
    loggedInUrlPattern: /^https:\/\/gemini\.google\.com\/(app|chat)/,
    inputSelectors: [
      { selector: 'rich-textarea .ql-editor', method: 'css', priority: 5, failCount: 0 },
      { selector: '[contenteditable="true"]', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: 'button.send-button', method: 'css', priority: 5, failCount: 0 },
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      { selector: '.model-response-text', method: 'css', priority: 5, failCount: 0 },
      { selector: '.response-content', method: 'css', priority: 4, failCount: 0 },
    ],
    quotaExhaustedIndicator: "text=You're out of free Gemini||text=You've used your free Gemini||text=upgrade to Gemini Advanced",
    // The mode selector button (observed aria-label "打开模式选择器，当前模式为…").
    modelSwitcherSelector: 'button[aria-label*="模式选择器"], model-picker button, button[aria-label*="model" i]',
    // Free tier (verified 2026-05-30): three switchable models in the mode
    // selector. Labels match the on-page text exactly so the text-match click
    // path in chat:switch-model works (it matches by innerText.includes(label)).
    availableModels: [
      { id: 'gemini-3-1-flash-lite', label: '3.1 Flash-Lite' },
      { id: 'gemini-3-5-flash',      label: '3.5 Flash' },
      { id: 'gemini-3-1-pro',        label: '3.1 Pro' },
    ],
    freeTierCapabilities: {
      verifiedAt: '2026-05-30',
      modelSwitch: true,
      fileUpload: true,
      webSearch: true,
      deepThink: true,
      deepResearch: true,
      imageGen: true,
      audioGen: true,
      notes:
        '免费版可切三档模型：3.1 Flash-Lite / 3.5 Flash / 3.1 Pro，并可调“思考等级”。' +
        '上传来源：文件 / Google 云端硬盘 / 相册 / Notebooks。联网为内置自动 grounding。' +
        '工具：图片生成与编辑、音乐（制作音轨）、Canvas、学习辅导。',
    },
  },
  {
    hostname: 'chat.deepseek.com',
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    // Post-login URL: /chat or root with chat parameter
    // ⚠️ Validate against real post-login DeepSeek URL
    loggedInUrlPattern: /^https:\/\/chat\.deepseek\.com\/(chat|r\/chat)?/,
    inputSelectors: [
      { selector: '#chat-input', method: 'css', priority: 5, failCount: 0 },
      { selector: 'textarea', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 5, failCount: 0 },
      { selector: '[role="button"][aria-label*="发送"]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      { selector: '.ds-markdown', method: 'css', priority: 5, failCount: 0 },
      { selector: '.markdown-body', method: 'css', priority: 4, failCount: 0 },
    ],
    quotaExhaustedIndicator: 'text=Your account has reached the free usage limit',
    // Free tier (verified 2026-05-30): no model dropdown. Behaviour is driven by
    // a "快速模式 / 专家模式" radio plus two one-click toggles ("深度思考" = R1
    // reasoning, "智能搜索" = web search). There is no ModelOption list to drive,
    // so availableModels is intentionally absent (ModelPicker stays hidden).
    freeTierCapabilities: {
      verifiedAt: '2026-05-30',
      modelSwitch: false,
      fileUpload: true,
      webSearch: true,
      deepThink: true,
      deepResearch: false,
      imageGen: false,
      audioGen: false,
      notes:
        '无模型下拉；通过“快速模式/专家模式”切换，外加“深度思考”(R1) 与“智能搜索”两个一键开关。' +
        '输入框 📎 支持文件上传。无图像/音乐生成。',
    },
    // M12: DeepSeek exposes both tools as direct composer buttons whose on/off
    // state is reflected by aria-pressed — the cleanest, most reliable toggles.
    toolToggles: [
      { id: 'deepThink', label: '深度思考', selector: 'text=深度思考' },
      { id: 'webSearch', label: '智能搜索', selector: 'text=智能搜索' },
    ],
  },
  {
    hostname: 'kimi.moonshot.cn',
    label: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    // Post-login URL: chat page
    // ⚠️ Validate against real post-login Kimi URL
    loggedInUrlPattern: /^https:\/\/kimi\.moonshot\.cn\/(chat\/)?/,
    inputSelectors: [
      { selector: '[data-testid="msh-chatinput-editor"]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'div[contenteditable="true"]', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: '[data-testid="msh-chatinput-send-button"]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      { selector: '.segment-content', method: 'css', priority: 5, failCount: 0 },
      { selector: '.prose', method: 'css', priority: 4, failCount: 0 },
    ],
    quotaExhaustedIndicator: 'text=今日免费额度',
  },
  {
    hostname: 'grok.com',
    label: 'Grok',
    url: 'https://grok.com',
    // Post-login URL: /chat/<id> or root with chat
    // ⚠️ Selectors and URL pattern are estimated; validate against live Grok DOM before shipping
    loggedInUrlPattern: /^https:\/\/grok\.com\/(chat\/)?/,
    inputSelectors: [
      { selector: 'textarea[placeholder*="message" i], textarea[placeholder*="Ask" i]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'div[contenteditable="true"]', method: 'css', priority: 4, failCount: 0 },
    ],
    sendSelectors: [
      { selector: 'button[aria-label*="send" i]', method: 'css', priority: 5, failCount: 0 },
      { selector: 'button[type="submit"]', method: 'css', priority: 4, failCount: 0 },
    ],
    responseSelectors: [
      { selector: '.message-content', method: 'css', priority: 5, failCount: 0 },
      { selector: '.prose', method: 'css', priority: 4, failCount: 0 },
      { selector: '[class*="response"]', method: 'css', priority: 3, failCount: 0 },
    ],
  },
]

// ─── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Find a preset by hostname.
 * Tries exact match first, then suffix match (e.g. `sub.chatgpt.com` → `chatgpt.com`).
 */
export function findPreset(hostname: string): SitePreset | undefined {
  const exact = PRESETS.find((p) => p.hostname === hostname)
  if (exact) return exact
  return PRESETS.find((p) => hostname.endsWith(p.hostname))
}
