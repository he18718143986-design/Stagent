/* ------------------------------------------------------------------ */
/*  Reply-path helpers — pure settle-once race + timeout hints        */
/* ------------------------------------------------------------------ */

import type { WebContents } from 'electron'
import type { WatchResult } from './response-watcher'
import { isLikelyAuthorLabel } from './response-watcher'

/**
 * Returns true when a network interceptor result should be used directly,
 * without falling back to the DOM watcher.
 *
 * Exported for unit-testing without an Electron harness.
 */
export function networkInterceptorAccepted(r: WatchResult): boolean {
  if (typeof r.text === 'string' && isLikelyAuthorLabel(r.text)) return false
  if (r.quotaExhausted) return true
  if (typeof r.text === 'string' && r.text.trim().length > 0) return true
  if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) return true
  return false
}

export async function pickReply(
  interceptorPromise: Promise<WatchResult | null>,
  domPromise: Promise<WatchResult>,
): Promise<WatchResult> {
  const networkResult = await interceptorPromise
  if (networkResult !== null && networkInterceptorAccepted(networkResult)) {
    return networkResult
  }
  return domPromise
}

export function raceReply(
  interceptorPromise: Promise<WatchResult | null>,
  domPromise: Promise<WatchResult>,
  onLate?: (source: 'network' | 'dom') => void,
): Promise<{ source: 'network' | 'dom'; result: WatchResult }> {
  return new Promise((resolve) => {
    let settled = false
    let networkDone = false
    let domDone = false
    let lastDomResult: WatchResult = { text: '' }

    const trySettle = (
      source: 'network' | 'dom',
      result: WatchResult,
    ): boolean => {
      if (settled) {
        onLate?.(source)
        return false
      }
      settled = true
      resolve({ source, result })
      return true
    }

    const settleFallbackIfBothDone = (): void => {
      if (settled) return
      if (networkDone && domDone) {
        if (typeof lastDomResult.text === 'string' && isLikelyAuthorLabel(lastDomResult.text)) {
          trySettle('dom', { text: '', timedOut: true })
          return
        }
        trySettle('dom', lastDomResult)
      }
    }

    interceptorPromise
      .then((networkResult) => {
        networkDone = true
        if (networkResult !== null && networkInterceptorAccepted(networkResult)) {
          trySettle('network', networkResult)
          return
        }
        settleFallbackIfBothDone()
      })
      .catch(() => {
        networkDone = true
        settleFallbackIfBothDone()
      })

    domPromise
      .then((domResult) => {
        domDone = true
        lastDomResult = domResult
        if (networkInterceptorAccepted(domResult)) {
          trySettle('dom', domResult)
          return
        }
        settleFallbackIfBothDone()
      })
      .catch(() => {
        domDone = true
        lastDomResult = { text: '' }
        settleFallbackIfBothDone()
      })
  })
}

export function deriveTimeoutHintFromText(raw: string): string | undefined {
  const t = raw.toLowerCase()
  const has = (s: string): boolean => t.includes(s)
  if (has('ssl') || has('certificate') || has('net_error') || has('handshake')) {
    return '检测到证书/SSL 握手异常，可能是代理、网络或系统证书问题。请检查网络环境后重试。'
  }
  if (has('network error') || has('connection') || has('failed to fetch') || has('timeout')) {
    return '检测到网络连接异常，AI 响应流中断。请检查网络或稍后重试。'
  }
  if (has('verify') || has('验证') || has('风控') || has('suspicious') || has('unusual activity')) {
    return '检测到账号验证/风控提示，当前会话可能被限制。请先在网页中完成验证后再试。'
  }
  if (has('try again') || has('重试') || has('something went wrong') || has('出了点问题')) {
    return '页面返回了错误提示（可重试）。建议在网页中点击重试，或稍后再发送。'
  }
  return undefined
}

export async function getTimeoutFailureHint(
  webContents: WebContents,
  hostname: string,
): Promise<string | undefined> {
  try {
    const raw: string = await webContents.executeJavaScript(`
      (function() {
        function safeText(el) {
          if (!el) return '';
          var t = (el.innerText || el.textContent || '').trim();
          return t;
        }
        var chunks = [];
        var sels = [
          '[role="alert"]',
          '[aria-live]',
          '[data-testid*="error"]',
          '[class*="error"]',
          '[class*="warning"]',
          '[class*="toast"]',
          'button',
          'a'
        ];
        for (var i = 0; i < sels.length; i++) {
          var nodes = document.querySelectorAll(sels[i]);
          for (var j = 0; j < nodes.length && j < 12; j++) {
            var txt = safeText(nodes[j]);
            if (!txt) continue;
            if (txt.length > 220) txt = txt.slice(0, 220);
            chunks.push(txt);
          }
        }
        var body = safeText(document.body);
        if (body) chunks.push(body.slice(0, 1200));
        return chunks.join('\\n');
      })()
    `)
    const hint = deriveTimeoutHintFromText(raw || '')
    if (!hint) return undefined
    return `[${hostname}] ${hint}`
  } catch {
    return undefined
  }
}
