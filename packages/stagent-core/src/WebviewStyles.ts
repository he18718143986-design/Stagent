/** Webview 样式（由 WebviewPanel 组装进 <style>）。重构自 WebviewPanel.ts，内容保持不变。 */
export const WEBVIEW_STYLES = `    body { font-family: system-ui, sans-serif; margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; }
    h1 { font-size: 1.1rem; margin: 0 0 12px; flex-shrink: 0; }
    textarea { width: 100%; min-height: 120px; box-sizing: border-box; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    button { padding: 8px 14px; margin-right: 8px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .view { display: none; }
    .view.active { display: block; }
    .view.active.input-chat-layout { display: flex; flex-direction: column; justify-content: flex-end; }
    .row { display: flex; gap: 12px; min-height: 320px; }
    #timeline, #timeline-exec { flex: 0 0 240px; border-right: 1px solid var(--vscode-widget-border); padding-right: 8px; overflow-y: auto; }
    #timeline li, #timeline-exec li { cursor: pointer; padding: 6px 4px; list-style: none; border-radius: 4px; margin-bottom: 4px; }
    #timeline li:hover { background: var(--vscode-list-hoverBackground); }
    #timeline li.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    #detail { flex: 1; overflow-y: auto; font-size: 0.9rem; white-space: pre-wrap; }
    #exec-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    #output { flex: 1; overflow-y: auto; padding: 8px; border: 1px solid var(--vscode-widget-border); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; min-height: 180px; }
    .badge { font-size: 0.75rem; opacity: 0.85; margin-left: 6px; }
    .decision { color: var(--vscode-charts-orange); }
    .muted { opacity: 0.75; font-size: 0.85rem; }
    .banner { padding: 10px; margin-top: 12px; background: var(--vscode-editorInfo-foreground); opacity: 0.9; border-radius: 4px; color: var(--vscode-editor-background); }
    .error { color: var(--vscode-errorForeground); }
    #pause-bar { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--vscode-widget-border); }
    #pause-bar input[type=text] { width: 100%; box-sizing: border-box; margin: 8px 0; padding: 6px; }
    #decision-editor { min-height: 300px; font-family: var(--vscode-editor-font-family); }
    .q-panel { border: 1px solid var(--vscode-widget-border); padding: 10px; margin-top: 10px; border-radius: 4px; }
    .q-item { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    ul { padding-left: 0; margin: 0; }
    .error-card { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 12px; margin-top: 8px; background: var(--vscode-editor-background); }
    .error-card-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
    .error-card-title { font-weight: 600; font-size: 1rem; }
    .error-msg-box { max-height: 180px; overflow: auto; padding: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 0.82rem; white-space: pre-wrap; margin: 8px 0; }
    .error-expand { margin-top: 8px; padding: 8px; border: 1px dashed var(--vscode-widget-border); border-radius: 4px; display: none; font-family: var(--vscode-editor-font-family); font-size: 0.78rem; white-space: pre-wrap; max-height: 220px; overflow: auto; }
    .error-expand.visible { display: block; }
    .error-actions { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
    .confidence { font-size: 0.72rem; margin-left: 6px; font-family: var(--vscode-editor-font-family); opacity: 0.92; }
    .conf-high { color: var(--vscode-charts-green, #89d185); }
    .conf-medium { color: var(--vscode-charts-yellow, #cca700); }
    .conf-low { color: var(--vscode-charts-orange, #d18616); }
    .conf-critical { color: var(--vscode-errorForeground); }
    .downstream-reset-panel { margin-top: 12px; padding: 10px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; font-size: 0.85rem; }
    .downstream-reset-panel ul { padding-left: 16px; margin: 6px 0; }
    .artifact-row { margin: 10px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .gen-status-panel { margin-top: 0; padding: 0; border: none; border-radius: 0; background: transparent; }
    .gen-status-panel.error .chat-bubble-assistant { border-color: var(--vscode-errorForeground); }
    .gen-status-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .gen-spinner { width: 14px; height: 14px; border: 2px solid var(--vscode-widget-border); border-top-color: var(--vscode-focusBorder); border-radius: 50%; animation: gen-spin 0.9s linear infinite; flex-shrink: 0; }
    @keyframes gen-spin { to { transform: rotate(360deg); } }
    .gen-stream-preview { margin: 8px 0 0; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 0.78rem; opacity: 0.92; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .input-chat-layout { flex: 1; box-sizing: border-box; padding: 0 10px 10px; min-height: 0; }
    .input-chat-shell { flex: 0 1 auto; display: flex; flex-direction: column; width: 100%; max-width: 900px; margin: 0 auto; min-height: 0; max-height: calc(100vh - 72px); }
    .input-chat-shell.has-history { overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; }
    .chat-history { display: none; flex: 0 0 auto; flex-direction: column; gap: 14px; padding: 0 4px 12px; box-sizing: border-box; overflow: visible; }
    .chat-row-user { display: flex; justify-content: flex-end; }
    .chat-row-assistant { display: flex; justify-content: flex-start; width: 100%; }
    .chat-bubble-user { max-width: 92%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 10px 14px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; font-size: 0.9rem; line-height: 1.5; word-break: break-word; }
    .chat-bubble-assistant { width: 100%; max-width: 100%; box-sizing: border-box; background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px 16px 16px 16px; padding: 12px 14px; }
    .chat-assistant-label { font-size: 0.75rem; opacity: 0.75; margin-bottom: 8px; }
    .composer-dock { flex-shrink: 0; border: 1px solid var(--vscode-input-border); border-radius: 12px; background: var(--vscode-input-background); overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    #input-composer #user-input { border: none; min-height: 108px; resize: none; border-radius: 0; font-size: 0.95rem; line-height: 1.55; padding: 14px 16px; width: 100%; box-sizing: border-box; display: block; background: transparent; color: var(--vscode-input-foreground); overflow: hidden; }
    #input-composer #user-input:focus { outline: none; }
    .composer-footer { padding: 10px 12px; border-top: 1px solid var(--vscode-widget-border); display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--vscode-editor-background); }
    .composer-path { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; max-width: 100%; }
    .composer-path label { font-size: 0.8rem; white-space: nowrap; }
    .composer-path input { width: min(360px, 52vw); min-width: 140px; padding: 6px 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; font-size: 0.82rem; }
    .composer-actions { display: none; gap: 10px; justify-content: center; flex-wrap: wrap; padding: 10px 12px 12px; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-editor-background); }
    .gen-status-panel { margin-top: 0; padding: 0; border: none; border-radius: 0; background: transparent; }
    .gen-status-panel.error .chat-bubble-assistant { border-color: var(--vscode-errorForeground); }
    .polish-result-edit { min-height: 3.5em; width: 100%; box-sizing: border-box; font-size: 0.88rem; line-height: 1.45; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); overflow: hidden; resize: none; }
    .chat-inline-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 10px; }
    .polish-loading { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; opacity: 0.9; }
    .polish-inline-error { color: var(--vscode-errorForeground); font-size: 0.85rem; margin-top: 6px; display: none; }
    .plan-summary { margin-bottom: 8px; padding: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; font-size: 0.85rem; white-space: pre-wrap; }
    .plan-diff { margin-bottom: 8px; padding: 8px; border: 1px dashed var(--vscode-widget-border); border-radius: 4px; font-size: 0.82rem; white-space: pre-wrap; }
    .plan-review-panel { margin-bottom: 8px; padding: 8px; border: 1px solid var(--vscode-editorInfo-foreground); border-radius: 4px; font-size: 0.85rem; white-space: pre-wrap; opacity: 0.95; }
    .confirm-block { border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 0.85rem; line-height: 1.5; }
    .confirm-block h4 { margin: 0 0 6px; font-size: 0.9rem; }
    .confirm-block ul { margin: 0; padding-left: 18px; }
    .confirm-footer { padding: 8px 0 12px; border-bottom: 1px solid var(--vscode-widget-border); margin-bottom: 8px; }
    .confirm-stats { display: flex; flex-wrap: wrap; gap: 12px 20px; font-size: 0.85rem; opacity: 0.92; }
    .confirm-stats span b { font-weight: 600; opacity: 1; }
    #confirm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    .plan-artifacts { margin-bottom: 8px; padding: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; font-size: 0.82rem; }
    .plan-artifacts h4 { margin: 0 0 6px; font-size: 0.8rem; font-weight: 600; opacity: 0.85; }
    .plan-artifacts ul { margin: 0; padding-left: 18px; }
    .plan-artifacts .artifact-warn { color: var(--vscode-inputValidation-warningForeground); margin-top: 6px; font-size: 0.8rem; }
    .plan-stage-cards { max-height: 38vh; overflow-y: auto; margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
    .plan-stage-card { padding: 10px 12px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; border-left: 3px solid var(--vscode-activityBarBadge-background); cursor: pointer; }
    .plan-stage-card:hover { background: var(--vscode-list-hoverBackground); }
    .plan-stage-card.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .plan-stage-card .card-title { font-size: 0.88rem; font-weight: 600; margin: 0; }
    .plan-stage-card .card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; font-size: 0.72rem; }
    .plan-stage-card .tag { padding: 2px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .plan-stage-card .tag.pause { background: rgba(232, 160, 0, 0.25); color: #e8a000; }
    .plan-stage-card .tag.decision { color: var(--vscode-charts-orange); }
    .plan-stage-card .artifact-line { font-family: var(--vscode-editor-font-family); font-size: 0.76rem; margin-top: 6px; opacity: 0.88; }
    .plan-stage-card .card-aitip { font-size: 0.78rem; margin-top: 6px; opacity: 0.9; line-height: 1.4; }
    .plan-phase-header { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin: 6px 0 2px; }`;
