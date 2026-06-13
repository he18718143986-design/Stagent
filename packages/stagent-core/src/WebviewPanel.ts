import { WEBVIEW_STYLES } from './WebviewStyles';
import { buildWebviewScript } from './WebviewScript';

/**
 * 最小结构化类型，替代对 `@types/vscode` 的硬依赖（核心保持平台中立）。
 * 任意暴露 `cspSource` 的对象（含 vscode.Webview）都满足此契约。
 */
interface WebviewLike {
  readonly cspSource: string;
}

function getNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

export function buildWorkflowWebviewHtml(webview: WebviewLike): string {
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Stagent</title>
  <style>
${WEBVIEW_STYLES}
  </style>
</head>
<body>
  <h1>Stagent · Decision-First Workflow</h1>

  <section id="view-input" class="view active input-chat-layout">
    <div id="input-chat-shell" class="input-chat-shell">
      <p id="polish-hint" class="muted" style="display:none;margin:8px 0;padding:8px;border:1px solid var(--vscode-widget-border);border-radius:6px;font-size:0.85rem;text-align:center;"></p>
      <div id="chat-history" class="chat-history" style="display:none" role="log" aria-live="polite">
        <div class="chat-row-user">
          <div id="user-message-bubble" class="chat-bubble-user"></div>
        </div>
        <div id="polish-assistant" class="chat-row-assistant" style="display:none">
          <div class="chat-bubble-assistant">
            <div class="chat-assistant-label">润色结果</div>
            <div id="polish-loading" class="polish-loading" style="display:none">
              <span class="gen-spinner"></span>
              <span id="polish-loading-text">正在润色…</span>
            </div>
            <textarea id="polish-result-edit" class="polish-result-edit" style="display:none" placeholder="润色完成后将显示在此，可直接编辑…"></textarea>
            <div id="polish-inline-error" class="polish-inline-error"></div>
            <div class="chat-inline-actions">
              <button type="button" id="btn-polish-apply" disabled>采用并写回</button>
              <button type="button" id="btn-polish-collapse" class="secondary">修改需求</button>
            </div>
          </div>
        </div>
        <div id="gen-status-panel" class="chat-row-assistant gen-status-panel" style="display:none" role="status" aria-live="polite">
          <div class="chat-bubble-assistant">
            <div class="chat-assistant-label">生成工作流</div>
            <div class="gen-status-head">
              <span class="gen-spinner" id="gen-status-spinner"></span>
              <strong id="gen-status-title">正在处理…</strong>
            </div>
            <div id="gen-status-detail" class="muted" style="font-size:0.85rem;line-height:1.45"></div>
            <details id="gen-stream-details" style="margin-top:8px;font-size:0.78rem;">
              <summary class="muted" style="cursor:pointer;">显示模型原始输出</summary>
              <pre id="gen-stream" class="gen-stream-preview"></pre>
            </details>
            <div class="chat-inline-actions">
              <button type="button" id="btn-regenerate" style="display:none">重新生成</button>
              <button type="button" id="btn-edit-message" class="secondary btn-edit-message" style="display:none">修改需求</button>
            </div>
          </div>
        </div>
      </div>
      <div id="composer-dock" class="composer-dock">
        <div id="input-composer">
          <textarea id="user-input" placeholder="描述你想完成的任务…"></textarea>
        </div>
        <div class="composer-footer">
          <div class="composer-path">
            <label for="task-workspace-path">工作文件夹 <span style="color:var(--vscode-errorForeground)">*</span></label>
            <input type="text" id="task-workspace-path" placeholder="/绝对路径 或 ~/项目目录" />
            <button type="button" id="btn-pick-workspace" class="secondary" style="padding:6px 10px;font-size:0.82rem;">浏览…</button>
          </div>
        </div>
        <div id="input-actions" class="composer-actions">
          <button type="button" id="btn-polish" class="secondary">需求润色</button>
          <button type="button" id="btn-gen">生成工作流</button>
        </div>
      </div>
    </div>
  </section>

  <section id="view-confirm" class="view">
    <div id="confirm-block" class="confirm-block" style="display:none"></div>
    <div id="confirm-footer" class="confirm-footer">
      <div id="confirm-stats" class="confirm-stats"></div>
    </div>
    <div class="row">
      <div>
        <strong>阶段</strong>
        <ul id="timeline"></ul>
      </div>
      <div id="confirm-main">
        <div id="plan-summary" class="plan-summary" style="display:none"></div>
        <div id="plan-diff" class="plan-diff" style="display:none"></div>
        <div id="plan-artifacts" class="plan-artifacts" style="display:none"></div>
        <div id="plan-stage-cards" class="plan-stage-cards"></div>
        <div id="detail"></div>
      </div>
    </div>
    <p style="margin-top:12px">
      <button id="btn-start">开始执行</button>
      <button id="btn-back-input" type="button" class="secondary">返回修改需求</button>
    </p>
    <p id="wf-warn" class="muted"></p>
  </section>

  <section id="view-exec" class="view">
    <div class="row">
      <div>
        <strong>进度</strong>
        <ul id="timeline-exec"></ul>
      </div>
      <div id="exec-main">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div id="output-label" class="muted"></div>
          <button id="btn-copy-debug" class="secondary" style="padding:4px 8px;font-size:0.75rem;">复制全部调试日志</button>
        </div>
        <div id="output"></div>
        <div id="downstream-reset-panel" style="display:none"></div>
        <div id="pause-bar" style="display:none"></div>
      </div>
    </div>
    <div id="done-banner" style="display:none" class="banner">工作流已全部完成。</div>
    <div id="fail-banner" style="display:none" class="banner error"></div>
  </section>

  <script nonce="${nonce}">
${buildWebviewScript()}
  </script>
</body>
</html>`;
}
