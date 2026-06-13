/* ------------------------------------------------------------------ */
/*  src/preload/index.ts — contextBridge: exposes autoAI API to renderer */
/* ------------------------------------------------------------------ */

import { contextBridge, ipcRenderer } from 'electron'
import type { AutoAIAPI, AutomationResult } from './index.d'

// ─── Expose to renderer as window.autoAI ────────────────────────────────────

const api: AutoAIAPI = {
  // M1: IPC round-trip test
  ping: () => ipcRenderer.invoke('ping'),

  // M2+: Site management (stubs — implementations added per milestone)
  site: {
    add: (url, label) => ipcRenderer.invoke('site:add', url, label),
    remove: (siteId) => ipcRenderer.invoke('site:remove', siteId),
    list: () => ipcRenderer.invoke('site:list'),
    openLogin: (siteId) => ipcRenderer.invoke('site:open-login', siteId),
    closeLogin: (siteId) => ipcRenderer.invoke('site:close-login', siteId),
    closeAllLogins: () => ipcRenderer.invoke('site:close-all-logins'),
    updateSelectors: (siteId, fields) =>
      ipcRenderer.invoke('site:update-selectors', siteId, fields),
    checkQuota: (siteId) => ipcRenderer.invoke('site:check-quota', siteId),
    rename: (siteId, label) => ipcRenderer.invoke('site:rename', siteId, label),
    showView: (siteId) => ipcRenderer.invoke('site:show-view', siteId),
    hideView: (siteId) => ipcRenderer.invoke('site:hide-view', siteId),
    onLoginSuccess: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { siteId: string }) => cb(payload)
      ipcRenderer.on('site:login-success', handler)
      return () => ipcRenderer.removeListener('site:login-success', handler)
    },
    onStatusChanged: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { siteId: string; status: import('./index.d').SiteStatus }) => cb(payload)
      ipcRenderer.on('site:status-changed', handler)
      return () => ipcRenderer.removeListener('site:status-changed', handler)
    },
    onRuntimeEvent: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, payload: import('./index.d').SiteRuntimeEvent) => cb(payload)
      ipcRenderer.on('site:runtime-event', handler)
      return () => ipcRenderer.removeListener('site:runtime-event', handler)
    },
    getRuntimePolicy: () => ipcRenderer.invoke('site:get-runtime-policy'),
    setRuntimePolicy: (patch) => ipcRenderer.invoke('site:set-runtime-policy', patch),
    getRuntimeStats: (siteId) => ipcRenderer.invoke('site:get-runtime-stats', siteId),
    clearRuntimeStats: (siteId) => ipcRenderer.invoke('site:clear-runtime-stats', siteId),
    getNetworkDiagnostics: () => ipcRenderer.invoke('site:get-network-diagnostics'),
    refreshNetworkDiagnostics: () => ipcRenderer.invoke('site:refresh-network-diagnostics'),
    getLastChatFailure: () => ipcRenderer.invoke('site:get-last-chat-failure'),
    listRecentChatFailures: (limit) => ipcRenderer.invoke('site:list-recent-chat-failures', limit),
    clearChatFailures: () => ipcRenderer.invoke('site:clear-chat-failures'),
    getAutomationMetrics: () => ipcRenderer.invoke('site:get-automation-metrics'),
    resetAutomationMetrics: () => ipcRenderer.invoke('site:reset-automation-metrics'),
  },

  // M3+: Chat
  chat: {
    send: (siteId, text) => ipcRenderer.invoke('chat:send', siteId, text),
    onReply: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { siteId: string; result: AutomationResult }) =>
        cb(payload as { siteId: string; result: AutomationResult })
      ipcRenderer.on('chat:reply', handler)
      return () => ipcRenderer.removeListener('chat:reply', handler)
    },
    onQuotaExhausted: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, siteId: string) => cb(siteId)
      ipcRenderer.on('chat:quota-exhausted', handler)
      return () => ipcRenderer.removeListener('chat:quota-exhausted', handler)
    },
    // M11: model switching
    switchModel: (siteId, modelId) => ipcRenderer.invoke('chat:switch-model', siteId, modelId),
    listModels: (siteId) => ipcRenderer.invoke('chat:list-models', siteId),
    // M12: one-click tool toggles (深度思考 / 联网搜索 …)
    listTools: (siteId) => ipcRenderer.invoke('chat:list-tools', siteId),
    toggleTool: (siteId, toolId, enable) =>
      ipcRenderer.invoke('chat:toggle-tool', siteId, toolId, enable),
  },

  // M5+: Calibration
  calibrate: {
    start: (siteId) => ipcRenderer.invoke('calibrate:start', siteId),
    cancel: (siteId) => ipcRenderer.invoke('calibrate:cancel', siteId),
    onDone: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, siteId: string) => cb(siteId)
      ipcRenderer.on('calibrate:done', handler)
      return () => ipcRenderer.removeListener('calibrate:done', handler)
    },
    onStep: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, data: { step: 1 | 2; instruction: string }) => cb(data)
      ipcRenderer.on('calibrate:step', handler)
      return () => ipcRenderer.removeListener('calibrate:step', handler)
    },
    onNeeded: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { siteId: string }) => cb(payload)
      ipcRenderer.on('calibrate:needed', handler)
      return () => ipcRenderer.removeListener('calibrate:needed', handler)
    },
  },
  adapter: {
    getInfo: () => ipcRenderer.invoke('adapter:get-info'),
  },

  // Stagent: decision-first workflow engine (@stagent/core via main process)
  stagent: {
    send: (msg) => ipcRenderer.invoke('stagent:send', msg),
    listTasks: () => ipcRenderer.invoke('stagent:list-tasks'),
    listTaskItems: () => ipcRenderer.invoke('stagent:list-task-items'),
    recoverable: () => ipcRenderer.invoke('stagent:recoverable'),
    resume: (instanceKey) => ipcRenderer.invoke('stagent:resume', instanceKey),
    delete: (instanceKey, scope) => ipcRenderer.invoke('stagent:delete', instanceKey, scope),
    prune: () => ipcRenderer.invoke('stagent:prune'),
    getControls: () => ipcRenderer.invoke('stagent:get-controls'),
    setModel: (modelFamily) => ipcRenderer.invoke('stagent:set-model', modelFamily),
    getConfig: () => ipcRenderer.invoke('stagent:get-config'),
    setConfig: (patch) => ipcRenderer.invoke('stagent:set-config', patch),
    reviewDecision: (stageId, decisionRecord) =>
      ipcRenderer.invoke('stagent:review-decision', { stageId, decisionRecord }),
    fsTree: (rootPath) => ipcRenderer.invoke('stagent:fs-tree', rootPath),
    fsRead: (filePath) => ipcRenderer.invoke('stagent:fs-read', filePath),
    fsWrite: (filePath, content) => ipcRenderer.invoke('stagent:fs-write', filePath, content),
    onEvent: (cb) => {
      const handler = (_: Electron.IpcRendererEvent, msg: unknown) => cb(msg)
      ipcRenderer.on('stagent:event', handler)
      return () => ipcRenderer.removeListener('stagent:event', handler)
    },
    onTasksChanged: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('stagent:tasks-changed', handler)
      return () => ipcRenderer.removeListener('stagent:tasks-changed', handler)
    },
  },
}

contextBridge.exposeInMainWorld('autoAI', api)
