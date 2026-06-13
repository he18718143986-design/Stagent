/** Webview 内联脚本（注入纯函数 + 事件/渲染逻辑）。重构自 WebviewPanel.ts，内容保持不变。 */
import { getPauseUiState } from './WebviewPauseUiState';
import { shouldHideOutput } from './WebviewUiState';
import { buildAnswerQuestionsBeforeMessage } from './QuestionBeforeFlow';
import { buildAnswerQuestionsMessage } from './QuestionAfterFlow';
import {
  canProceedRetry,
  getDecisionApproveAction,
  getUncheckedCount,
  shouldAskRetryConfirm,
  shouldShowDecisionConflictBanner,
  shouldShowQualitySoftPrompt,
} from './DecisionReviewUi';
import { formatGlobalConfigSummaryForConfirm } from './ArtifactUiHints';
import {
  buildPlanReviewChecklistLines,
  computePlanStageDiff,
  formatPlanStageDiffLines,
  formatPlanSummaryLines,
  formatStageSourceSummaryLines,
  isFirstDecisionStage,
  shouldShowPlanReviewChecklist,
} from './WorkflowPlanSummary';
import {
  buildLlmWaitingDetail,
  formatStreamCharSuffix,
} from './WebviewInputGenerationUi';
import {
  buildConfirmStatsLines,
  collectArtifactPathsFromStages,
  countStagesByKind,
  getArtifactHeuristicWarnings,
  getStageArtifactPath,
  normalizeArtifactPath,
  parsePhaseFromTitle,
  stripPhasePrefix,
  truncateConfirmText,
} from './WebviewConfirmPlanUi';

export function buildWebviewScript(): string {
  return `    ${getPauseUiState.toString()}
    ${shouldHideOutput.toString()}
    ${buildAnswerQuestionsBeforeMessage.toString()}
    ${buildAnswerQuestionsMessage.toString()}
    ${shouldShowQualitySoftPrompt.toString()}
    ${getUncheckedCount.toString()}
    ${shouldShowDecisionConflictBanner.toString()}
    ${getDecisionApproveAction.toString()}
    ${shouldAskRetryConfirm.toString()}
    ${canProceedRetry.toString()}
    ${formatGlobalConfigSummaryForConfirm.toString()}
    ${formatPlanSummaryLines.toString()}
    ${formatStageSourceSummaryLines.toString()}
    ${computePlanStageDiff.toString()}
    ${formatPlanStageDiffLines.toString()}
    ${isFirstDecisionStage.toString()}
    ${shouldShowPlanReviewChecklist.toString()}
    ${buildPlanReviewChecklistLines.toString()}
    ${formatStreamCharSuffix.toString()}
    ${buildLlmWaitingDetail.toString()}
    ${normalizeArtifactPath.toString()}
    ${getStageArtifactPath.toString()}
    ${collectArtifactPathsFromStages.toString()}
    ${getArtifactHeuristicWarnings.toString()}
    ${parsePhaseFromTitle.toString()}
    ${stripPhasePrefix.toString()}
    ${truncateConfirmText.toString()}
    ${countStagesByKind.toString()}
    ${buildConfirmStatsLines.toString()}
    const vscode = acquireVsCodeApi();
    let workflowDef = null;
    let planSummary = null;
    let stageSourceSummary = [];
    let workflowWarnings = [];
    let lastGeneratedStageIds = [];
    let selectedStageId = null;
    const stageStatus = {};
    const stageOutputs = {};
    const stageConfidence = {};
    const stageArtifacts = {};
    let currentRunStageId = null;
    let currentPausedStageId = null;
    let currentBeforeQuestionStageId = null;
    const beforeQuestionsByStage = {};
    /** 最近一次「需求润色」的溯源：生成工作流时写入 meta.userInputPolish */
    let lastPolishContext = null;
    let polishOriginalDraft = '';
    let committedUserText = '';
    let inputBusyOp = null;
    let pendingClarifyInput = null;
    let genStreamChars = 0;
    let genStatusDetailBase = '';

    const DEFAULT_TASK_TYPE = 'auto';

    function renderGenStatusDetail() {
      document.getElementById('gen-status-detail').textContent =
        genStatusDetailBase + formatStreamCharSuffix(genStreamChars);
    }

    function setInputPageBusy(op, title, detail) {
      inputBusyOp = op;
      genStreamChars = 0;
      genStatusDetailBase = detail || '';
      document.getElementById('polish-assistant').style.display = 'none';
      document.getElementById('btn-edit-message').style.display = 'none';
      const panel = document.getElementById('gen-status-panel');
      const stream = document.getElementById('gen-stream');
      panel.style.display = 'flex';
      panel.classList.remove('error');
      document.getElementById('gen-status-spinner').style.display = '';
      document.getElementById('gen-status-title').textContent = title || '正在处理…';
      renderGenStatusDetail();
      stream.textContent = '';
      document.getElementById('btn-gen').disabled = true;
      document.getElementById('btn-polish').disabled = true;
      scrollChatPanelToBottom();
    }

    function updateInputPageProgress(message, detail) {
      const panel = document.getElementById('gen-status-panel');
      if (panel.style.display === 'none') {
        setInputPageBusy(inputBusyOp || 'workflow', message, detail);
        return;
      }
      if (message) document.getElementById('gen-status-title').textContent = message;
      if (typeof detail === 'string' && detail.length > 0) {
        genStatusDetailBase = detail;
      }
      renderGenStatusDetail();
    }

    function clearInputPageBusy() {
      inputBusyOp = null;
      genStreamChars = 0;
      genStatusDetailBase = '';
      document.getElementById('btn-gen').disabled = false;
      document.getElementById('btn-polish').disabled = false;
      document.getElementById('gen-status-panel').style.display = 'none';
      document.getElementById('gen-status-panel').classList.remove('error');
      document.getElementById('gen-stream').textContent = '';
      document.getElementById('btn-regenerate').style.display = 'none';
    }

    function showInputPageError(reason) {
      inputBusyOp = null;
      document.getElementById('btn-gen').disabled = false;
      document.getElementById('btn-polish').disabled = false;
      document.getElementById('polish-assistant').style.display = 'none';
      const panel = document.getElementById('gen-status-panel');
      panel.style.display = 'flex';
      panel.classList.add('error');
      document.getElementById('gen-status-spinner').style.display = 'none';
      document.getElementById('gen-status-title').textContent = '处理失败';
      document.getElementById('gen-status-detail').textContent = reason || '未知错误';
      document.getElementById('btn-regenerate').style.display = '';
      document.getElementById('btn-edit-message').style.display = '';
    }

    function isInputReady() {
      return (
        document.getElementById('user-input').value.trim().length > 0 &&
        document.getElementById('task-workspace-path').value.trim().length > 0
      );
    }

    function syncInputActionsVisibility() {
      const actions = document.getElementById('input-actions');
      actions.style.display = isInputReady() ? 'flex' : 'none';
    }

    function scrollChatPanelToBottom() {
      const shell = document.getElementById('input-chat-shell');
      shell.scrollTop = shell.scrollHeight;
    }

    function syncTextareaHeight(el) {
      if (!el || el.style.display === 'none') {
        return;
      }
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function syncPolishResultHeight() {
      const edit = document.getElementById('polish-result-edit');
      syncTextareaHeight(edit);
      requestAnimationFrame(() => {
        syncTextareaHeight(edit);
        scrollChatPanelToBottom();
      });
    }

    function syncComposerInputHeight() {
      const input = document.getElementById('user-input');
      syncTextareaHeight(input);
      requestAnimationFrame(() => syncTextareaHeight(input));
    }

    function commitUserMessage(text) {
      committedUserText = text;
      document.getElementById('user-message-bubble').textContent = text;
      const history = document.getElementById('chat-history');
      history.style.display = 'flex';
      document.getElementById('composer-dock').style.display = 'none';
      document.getElementById('input-chat-shell').classList.add('has-history');
      scrollChatPanelToBottom();
    }

    function showComposer(text, keepHistory) {
      const restore =
        typeof text === 'string'
          ? text
          : committedUserText || document.getElementById('user-input').value;
      if (!keepHistory) {
        document.getElementById('chat-history').style.display = 'none';
        document.getElementById('polish-assistant').style.display = 'none';
        document.getElementById('gen-status-panel').style.display = 'none';
        document.getElementById('gen-status-panel').classList.remove('error');
        document.getElementById('btn-edit-message').style.display = 'none';
        document.getElementById('input-chat-shell').classList.remove('has-history');
        committedUserText = '';
      } else {
        document.getElementById('polish-assistant').style.display = 'none';
        document.getElementById('gen-status-panel').style.display = 'none';
        document.getElementById('gen-status-panel').classList.remove('error');
        document.getElementById('btn-edit-message').style.display = 'none';
      }
      document.getElementById('composer-dock').style.display = 'block';
      document.getElementById('user-input').value = restore;
      syncComposerInputHeight();
      syncInputActionsVisibility();
    }

    function isPolishAssistantVisible() {
      return document.getElementById('polish-assistant').style.display !== 'none';
    }

    function openPolishPanel(originalText) {
      polishOriginalDraft = originalText;
      inputBusyOp = 'polish';
      document.getElementById('gen-status-panel').style.display = 'none';
      document.getElementById('btn-edit-message').style.display = 'none';
      commitUserMessage(originalText);
      document.getElementById('polish-result-edit').value = '';
      document.getElementById('polish-result-edit').style.display = 'none';
      document.getElementById('polish-loading').style.display = 'flex';
      document.getElementById('polish-loading-text').textContent = '正在润色…';
      document.getElementById('polish-inline-error').style.display = 'none';
      document.getElementById('polish-inline-error').textContent = '';
      document.getElementById('btn-polish-apply').disabled = true;
      document.getElementById('polish-assistant').style.display = 'flex';
      scrollChatPanelToBottom();
    }

    function closePolishPanel() {
      document.getElementById('polish-assistant').style.display = 'none';
      showComposer(polishOriginalDraft);
      if (inputBusyOp === 'polish') {
        inputBusyOp = null;
      }
    }

    function showPolishResult(text, fromCache) {
      document.getElementById('polish-loading').style.display = 'none';
      const edit = document.getElementById('polish-result-edit');
      edit.style.display = 'block';
      edit.value = text || '';
      document.getElementById('btn-polish-apply').disabled = !edit.value.trim();
      if (fromCache) {
        document.getElementById('polish-loading-text').textContent = '已使用内存缓存';
      }
      inputBusyOp = null;
      syncPolishResultHeight();
    }

    function showPolishPanelError(reason) {
      document.getElementById('polish-loading').style.display = 'none';
      document.getElementById('polish-result-edit').style.display = 'none';
      const err = document.getElementById('polish-inline-error');
      err.textContent = reason || '润色失败';
      err.style.display = 'block';
      document.getElementById('btn-polish-apply').disabled = true;
      inputBusyOp = null;
    }

    const viewInput = document.getElementById('view-input');
    const viewConfirm = document.getElementById('view-confirm');
    const viewExec = document.getElementById('view-exec');

    const isDecisionStage = (stageId) =>
      !!workflowDef?.stages?.find((s) => s.id === stageId)?.isDecisionStage;

    const approvedDecisionCount = () =>
      (workflowDef?.stages ?? []).filter((s) => s.isDecisionStage && stageStatus[s.id] === 'done').length;

    function syncOutputVisibility() {
      const output = document.getElementById('output');
      output.style.display = shouldHideOutput(currentPausedStageId, stageStatus, isDecisionStage) ? 'none' : 'block';
    }

    function syncPauseBarVisibility() {
      const bar = document.getElementById('pause-bar');
      const uiState = getPauseUiState(currentPausedStageId, stageStatus, isDecisionStage);
      const showBeforeQuestions =
        !!currentBeforeQuestionStageId && stageStatus[currentBeforeQuestionStageId] === 'waiting-questions';
      bar.style.display = uiState.showPauseBar || showBeforeQuestions ? 'block' : 'none';
      return uiState;
    }

    function show(view) {
      viewInput.classList.toggle('active', view === 'input');
      viewConfirm.classList.toggle('active', view === 'confirm');
      viewExec.classList.toggle('active', view === 'exec');
    }

    document.getElementById('btn-pick-workspace').onclick = () => {
      vscode.postMessage({ type: 'pickTaskWorkspaceFolder' });
    };

    document.getElementById('user-input').addEventListener('input', () => {
      syncComposerInputHeight();
      syncInputActionsVisibility();
    });
    document.getElementById('task-workspace-path').addEventListener('input', syncInputActionsVisibility);

    document.getElementById('btn-polish-collapse').onclick = () => {
      closePolishPanel();
    };

    document.getElementById('btn-edit-message').onclick = () => {
      showComposer(committedUserText, true);
      inputBusyOp = null;
    };

    document.getElementById('btn-polish-apply').onclick = () => {
      const polished = document.getElementById('polish-result-edit').value.trim();
      if (!polished) {
        return;
      }
      lastPolishContext = {
        originalDraft: polishOriginalDraft,
        polishedAt: new Date().toISOString(),
      };
      document.getElementById('polish-assistant').style.display = 'none';
      document.getElementById('user-input').value = polished;
      document.getElementById('composer-dock').style.display = 'block';
      document.getElementById('input-chat-shell').classList.add('has-history');
      syncComposerInputHeight();
      syncInputActionsVisibility();
      document.getElementById('btn-polish-apply').disabled = true;
      inputBusyOp = null;
      scrollChatPanelToBottom();
    };

    document.getElementById('polish-result-edit').addEventListener('input', () => {
      const edit = document.getElementById('polish-result-edit');
      document.getElementById('btn-polish-apply').disabled = !edit.value.trim();
      syncPolishResultHeight();
    });

    document.getElementById('btn-polish').onclick = () => {
      const draft = document.getElementById('user-input').value.trim();
      if (!isInputReady() || !draft) {
        return;
      }
      openPolishPanel(draft);
      vscode.postMessage({ type: 'polishUserTask', draft, taskType: DEFAULT_TASK_TYPE });
    };

    function sendGenerateWorkflow(userInput, clarifyAnswers) {
      const taskWorkspacePath = document.getElementById('task-workspace-path').value.trim();
      document.getElementById('polish-assistant').style.display = 'none';
      document.getElementById('btn-regenerate').style.display = 'none';
      setInputPageBusy(
        'workflow',
        '正在生成工作流',
        '已提交；正在准备工作区上下文与提示词…',
      );
      const payload = {
        type: 'generateWorkflow',
        userInput,
        taskType: DEFAULT_TASK_TYPE,
        taskWorkspacePath,
      };
      if (lastPolishContext) {
        payload.polishContext = lastPolishContext;
      }
      if (clarifyAnswers && Object.keys(clarifyAnswers).length > 0) {
        payload.clarifyAnswers = clarifyAnswers;
      }
      vscode.postMessage(payload);
    }

    document.getElementById('btn-gen').onclick = () => {
      const userInput = document.getElementById('user-input').value.trim();
      if (!isInputReady()) {
        return;
      }
      commitUserMessage(userInput);
      // 先发起生成前澄清；后端回应 clarifyQuestions（可能为空）后再进入生成。
      pendingClarifyInput = userInput;
      setInputPageBusy('workflow', '正在分析需求', '正在扫描工作文件夹并准备澄清问题…');
      vscode.postMessage({
        type: 'clarifyStart',
        userInput,
        taskType: DEFAULT_TASK_TYPE,
        taskWorkspacePath: document.getElementById('task-workspace-path').value.trim(),
      });
    };

    document.getElementById('btn-regenerate').onclick = () => {
      const userInput = (committedUserText || document.getElementById('user-input').value).trim();
      if (!userInput || !document.getElementById('task-workspace-path').value.trim()) {
        return;
      }
      sendGenerateWorkflow(userInput);
    };

    function closeClarifyOverlay() {
      const existing = document.getElementById('clarify-overlay');
      if (existing) {
        existing.remove();
      }
    }

    function renderClarifyOverlay(userInput, questions) {
      clearInputPageBusy();
      closeClarifyOverlay();
      const overlay = document.createElement('div');
      overlay.id = 'clarify-overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.45);padding:24px;';
      const card = document.createElement('div');
      card.style.cssText =
        'max-width:560px;width:100%;max-height:80vh;overflow:auto;border-radius:8px;padding:18px 20px;' +
        'background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.35);';
      let html = '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">生成前澄清</div>' +
        '<div style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:14px;">' +
        '回答以下问题有助于更准确地拆解工作流（可留空或跳过）。</div>';
      questions.forEach((q, idx) => {
        const qid = escapeHtml(q.id || ('q' + idx));
        html += '<div style="margin-bottom:14px;" data-qid="' + qid + '">';
        html += '<div style="font-size:12px;margin-bottom:6px;">' + escapeHtml(q.text || '') + '</div>';
        if (Array.isArray(q.options) && q.options.length > 0) {
          q.options.forEach((opt, oi) => {
            const optVal = escapeHtml(opt);
            html += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0;cursor:pointer;">' +
              '<input type="radio" name="clarify-' + qid + '" value="' + optVal + '"' + (oi === 0 ? ' checked' : '') + '>' +
              '<span>' + optVal + '</span></label>';
          });
        } else {
          html += '<input type="text" class="clarify-text" ' +
            'style="width:100%;padding:5px 8px;background:var(--vscode-input-background);' +
            'color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border, var(--vscode-panel-border));' +
            'border-radius:4px;font-size:12px;" placeholder="（可选）输入你的回答">';
        }
        html += '</div>';
      });
      html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
        '<button id="clarify-skip" style="padding:5px 12px;border:1px solid var(--vscode-panel-border);' +
        'background:transparent;color:var(--vscode-foreground);border-radius:4px;cursor:pointer;font-size:12px;">跳过</button>' +
        '<button id="clarify-submit" style="padding:5px 12px;border:none;' +
        'background:var(--vscode-button-background);color:var(--vscode-button-foreground);border-radius:4px;cursor:pointer;font-size:12px;">提交并生成</button>' +
        '</div>';
      card.innerHTML = html;
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const collectAnswers = () => {
        const answers = {};
        card.querySelectorAll('[data-qid]').forEach((block) => {
          const qid = block.getAttribute('data-qid');
          const radio = block.querySelector('input[type="radio"]:checked');
          const textInput = block.querySelector('input.clarify-text');
          if (radio) {
            answers[qid] = radio.value;
          } else if (textInput && textInput.value.trim()) {
            answers[qid] = textInput.value.trim();
          }
        });
        return answers;
      };

      card.querySelector('#clarify-submit').onclick = () => {
        const answers = collectAnswers();
        closeClarifyOverlay();
        sendGenerateWorkflow(userInput, answers);
      };
      card.querySelector('#clarify-skip').onclick = () => {
        closeClarifyOverlay();
        sendGenerateWorkflow(userInput);
      };
    }

    document.getElementById('btn-start').onclick = () => {
      if (!workflowDef) return;
      if (document.getElementById('btn-start').disabled) return;
      show('exec');
      vscode.postMessage({ type: 'startExecution', workflow: workflowDef });
      renderExecTimeline();
      resetExecUi();
    };

    document.getElementById('btn-back-input').onclick = () => {
      show('input');
      document.getElementById('user-input').focus();
    };

    document.getElementById('btn-copy-debug').onclick = () => {
      vscode.postMessage({ type: 'copyDebugLog' });
    };

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    const STAGE_ERROR_CARD = {
      'llm-timeout': { icon: '⏱️', title: 'LLM 响应超时', actions: [{ label: '重试', type: 'retry' }] },
      'llm-context-overflow': { icon: '📚', title: '输入内容过长', actions: [{ label: '编辑输入', type: 'editInput' }] },
      'llm-invalid-output': {
        icon: '📄',
        title: 'AI 输出格式解析失败',
        actions: [
          { label: '重试', type: 'retry' },
          { label: '查看原始输出', type: 'showRaw' },
        ],
      },
      'tool-execution-failed': {
        icon: '🔧',
        title: '命令执行失败',
        actions: [
          { label: '重试', type: 'retry' },
          { label: '查看完整输出', type: 'showOutput' },
        ],
      },
      'code-runner-timeout': { icon: '⏰', title: '命令执行超时', actions: [{ label: '重试', type: 'retry' }] },
      'file-not-found': { icon: '📁', title: '文件未找到', actions: [{ label: '检查路径', type: 'editInput' }] },
      'stage-not-found': { icon: '🔗', title: '前置阶段不存在', actions: [{ label: '编辑工作流', type: 'editWorkflow' }] },
      'invariant-violation': { icon: '⚙️', title: '系统内部错误', actions: [{ label: '查看日志', type: 'showLog' }] },
      'retry-limit-exceeded': {
        icon: '🔁',
        title: '手动重试次数已达上限',
        actions: [{ label: '查看日志', type: 'showLog' }],
      },
      unknown: {
        icon: '⚠️',
        title: '发生未知错误',
        actions: [
          { label: '重试', type: 'retry' },
          { label: '查看日志', type: 'showLog' },
        ],
      },
    };

    function renderStageErrorCard(msg) {
      const banner = document.getElementById('fail-banner');
      banner.style.display = 'block';
      banner.textContent = '';
      banner.className = 'banner error';

      const cfg = STAGE_ERROR_CARD[msg.errorType] || STAGE_ERROR_CARD.unknown;
      const actions = cfg.actions.map(function (a) {
        return { label: a.label, type: a.type };
      });
      if (isDecisionStage(msg.stageId) && !actions.some(function (a) { return a.type === 'editWorkflow'; })) {
        actions.push({ label: '编辑工作流', type: 'editWorkflow' });
      }

      const wrap = document.createElement('div');
      wrap.className = 'error-card';

      const head = document.createElement('div');
      head.className = 'error-card-head';
      const ic = document.createElement('span');
      ic.textContent = cfg.icon;
      ic.setAttribute('aria-hidden', 'true');
      const titWrap = document.createElement('div');
      const tit = document.createElement('div');
      tit.className = 'error-card-title';
      tit.textContent = cfg.title;
      const sub = document.createElement('div');
      sub.className = 'muted';
      sub.style.fontSize = '0.8rem';
      sub.textContent = '错误类型：' + msg.errorType;
      titWrap.appendChild(tit);
      titWrap.appendChild(sub);
      head.appendChild(ic);
      head.appendChild(titWrap);
      wrap.appendChild(head);

      const body = document.createElement('div');
      body.className = 'error-msg-box';
      body.textContent = msg.error || '';
      wrap.appendChild(body);

      const rawBox = document.createElement('div');
      rawBox.className = 'error-expand';
      rawBox.id = 'err-expand-raw';
      rawBox.innerHTML = '<div class="muted" style="margin-bottom:6px">原始输出</div><pre style="margin:0;white-space:pre-wrap">' +
        escapeHtml(msg.rawOutput || '(无)') +
        '</pre>';

      const outBox = document.createElement('div');
      outBox.className = 'error-expand';
      outBox.id = 'err-expand-out';
      const so = msg.stdout != null ? String(msg.stdout) : '';
      const se = msg.stderr != null ? String(msg.stderr) : '';
      outBox.innerHTML =
        '<div class="muted" style="margin-bottom:6px">stdout / stderr</div>' +
        '<div><strong>stdout</strong></div><pre style="margin:4px 0 8px;white-space:pre-wrap">' +
        escapeHtml(so || '(空)') +
        '</pre>' +
        '<div><strong>stderr</strong></div><pre style="margin:4px 0;white-space:pre-wrap">' +
        escapeHtml(se || '(空)') +
        '</pre>';

      wrap.appendChild(rawBox);
      wrap.appendChild(outBox);

      const row = document.createElement('div');
      row.className = 'error-actions';

      function toggleEl(el) {
        if (!el) return;
        el.classList.toggle('visible');
      }

      actions.forEach(function (act) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = act.label;
        if (act.type === 'showRaw' && !msg.rawOutput) {
          b.className = 'secondary';
          b.title = '本次错误未附带原始输出';
        }
        b.onclick = function () {
          switch (act.type) {
            case 'retry':
              vscode.postMessage({ type: 'retry', stageId: msg.stageId, comment: '' });
              break;
            case 'editInput':
              show('input');
              document.getElementById('user-input').focus();
              break;
            case 'showRaw':
              toggleEl(rawBox);
              break;
            case 'showOutput':
              toggleEl(outBox);
              break;
            case 'editWorkflow':
              if (!workflowDef) return;
              selectedStageId = msg.stageId;
              show('confirm');
              renderConfirmFooter();
              renderPlanArtifactsPanel();
              renderPlanStageCards();
              renderConfirmTimeline();
              showConfirmDetail();
              requestAnimationFrame(function () {
                const ul = document.getElementById('timeline');
                const hit = ul && ul.querySelector('li[data-id="' + msg.stageId.replace(/"/g, '') + '"]');
                if (hit) hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              });
              break;
            case 'showLog':
              vscode.postMessage({ type: 'copyDebugLog' });
              break;
            default:
              break;
          }
        };
        row.appendChild(b);
      });

      wrap.appendChild(row);
      banner.appendChild(wrap);
    }

    syncInputActionsVisibility();
    vscode.postMessage({ type: 'webviewReady' });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'workflowGenerated':
          clearInputPageBusy();
          workflowDef = msg.workflow;
          planSummary = msg.planSummary || null;
          stageSourceSummary = msg.stageSourceSummary || [];
          workflowWarnings = msg.warnings || [];
          selectedStageId = workflowDef.stages[0]?.id ?? null;
          (function renderConfirmBlock() {
            const blockEl = document.getElementById('confirm-block');
            const reasons = Array.isArray(msg.blockReasons) ? msg.blockReasons : [];
            const blocked = !!msg.blocked && reasons.length > 0;
            document.getElementById('btn-start').disabled = blocked;
            if (!blocked) {
              blockEl.style.display = 'none';
              blockEl.innerHTML = '';
              return;
            }
            let html = '<h4>⛔ 此计划暂不能开始执行（已展示供你审阅）</h4><ul>';
            for (const r of reasons) {
              html += '<li>' + escapeHtml(r) + '</li>';
            }
            html += '</ul><div>请「返回修改需求」收紧描述后重新生成，或在生成器侧补齐每个脚本的独立 writeOutputToFile 阶段。</div>';
            blockEl.innerHTML = html;
            blockEl.style.display = 'block';
          })();
          (function renderWorkflowWarnings() {
            const el = document.getElementById('wf-warn');
            const display = msg.warningsDisplay && msg.warningsDisplay.length
              ? msg.warningsDisplay
              : (msg.warnings || []);
            if (!display.length) {
              el.textContent = '';
              el.style.display = 'none';
              return;
            }
            el.style.display = 'block';
            el.textContent = '警告：\\n' + display.join('\\n');
          })();
          (function renderPlanPanels() {
            const summaryEl = document.getElementById('plan-summary');
            const diffEl = document.getElementById('plan-diff');
            const newIds = (workflowDef.stages || []).map((s) => s.id);
            const hadPrevious = lastGeneratedStageIds.length > 0;
            const diff = computePlanStageDiff(lastGeneratedStageIds, newIds);
            lastGeneratedStageIds = newIds;
            if (planSummary) {
              summaryEl.style.display = 'block';
              summaryEl.textContent = formatPlanSummaryLines(planSummary).join('\\n');
            } else {
              summaryEl.style.display = 'none';
              summaryEl.textContent = '';
            }
            const diffLines = formatPlanStageDiffLines(diff, hadPrevious);
            if (diffLines.length) {
              diffEl.style.display = 'block';
              diffEl.textContent = diffLines.join('\\n');
            } else {
              diffEl.style.display = 'none';
              diffEl.textContent = '';
            }
          })();
          renderConfirmFooter();
          renderPlanArtifactsPanel();
          renderPlanStageCards();
          renderConfirmTimeline();
          showConfirmDetail();
          show('confirm');
          lastPolishContext = null;
          break;
        case 'generationProgress':
          if (msg.operation === 'polish') {
            inputBusyOp = 'polish';
            break;
          }
          if (msg.operation === 'workflow') inputBusyOp = 'workflow';
          updateInputPageProgress(msg.message, msg.detail);
          break;
        case 'taskWorkspacePathPicked':
          document.getElementById('task-workspace-path').value = msg.path || '';
          syncInputActionsVisibility();
          break;
        case 'clarifyQuestions': {
          const input = pendingClarifyInput;
          pendingClarifyInput = null;
          const questions = Array.isArray(msg.questions) ? msg.questions : [];
          if (!input) {
            break;
          }
          if (questions.length === 0) {
            sendGenerateWorkflow(input);
          } else {
            renderClarifyOverlay(input, questions);
          }
          break;
        }
        case 'polishSessionHint': {
          const el = document.getElementById('polish-hint');
          el.textContent = msg.message || '';
          el.style.display = msg.message ? 'block' : 'none';
          break;
        }
        case 'userTaskPolished': {
          showPolishResult(msg.text || '', !!msg.fromCache);
          break;
        }
        case 'workflowFailed':
          if (isPolishAssistantVisible()) {
            showPolishPanelError(msg.reason);
          } else {
            showInputPageError(msg.reason);
          }
          break;
        case 'workflowCompleted':
          document.getElementById('done-banner').style.display = 'block';
          currentPausedStageId = null;
          syncPauseBarVisibility();
          syncOutputVisibility();
          break;
        case 'stageStatusUpdate':
          stageStatus[msg.stageId] = msg.status;
          if (msg.status === 'running') {
            currentRunStageId = msg.stageId;
            document.getElementById('output').textContent = '';
            document.getElementById('output-label').textContent = '运行中：' + msg.stageId;
          }
          if (msg.status === 'paused') {
            currentPausedStageId = msg.stageId;
          } else if (currentPausedStageId === msg.stageId) {
            currentPausedStageId = null;
          }
          if (msg.status !== 'waiting-questions' && currentBeforeQuestionStageId === msg.stageId) {
            currentBeforeQuestionStageId = null;
            delete beforeQuestionsByStage[msg.stageId];
          }
          {
            const uiState = syncPauseBarVisibility();
            if (uiState.showPauseBar && currentPausedStageId) {
              const sid = currentPausedStageId;
              if (isDecisionStage(sid)) {
                renderPauseBar(sid, uiState);
              } else {
                const qa = getQuestionAfter(sid);
                if (qa.length > 0) {
                  renderAfterQuestionsCard(sid, qa);
                } else {
                  renderPauseBar(sid, uiState);
                }
              }
            }
          }
          syncOutputVisibility();
          renderExecTimeline();
          break;
        case 'stageQuestions':
          if (stageStatus[msg.stageId] === 'paused' && currentPausedStageId === msg.stageId && !isDecisionStage(msg.stageId)) {
            renderAfterQuestionsCard(msg.stageId, msg.questions || []);
          }
          syncPauseBarVisibility();
          break;
        case 'stageQuestionsBefore':
          beforeQuestionsByStage[msg.stageId] = msg.questions || [];
          currentBeforeQuestionStageId = msg.stageId;
          renderBeforeQuestionsCard(msg.stageId, beforeQuestionsByStage[msg.stageId]);
          syncPauseBarVisibility();
          break;
        case 'stageOutputUpdate':
          stageOutputs[msg.stageId] = String(msg.content ?? '');
          if (msg.stageId === currentRunStageId) {
            document.getElementById('output').textContent = stageOutputs[msg.stageId];
          }
          if (msg.stageId === currentPausedStageId) {
            const editor = document.getElementById('decision-editor');
            if (editor) editor.value = stageOutputs[msg.stageId];
          }
          break;
        case 'stageConfidenceUpdate':
          stageConfidence[msg.stageId] = {
            score: Number(msg.score),
            level: msg.level || 'medium',
            reasons: Array.isArray(msg.reasons) ? msg.reasons : [],
          };
          renderExecTimeline();
          break;
        case 'streamChunk':
          if (msg.stageId === 'workflow-gen' || msg.stageId === 'task-polish' || msg.stageId === 'workflow-gen-repair') {
            genStreamChars += String(msg.chunk || '').length;
            const stream = document.getElementById('gen-stream');
            stream.textContent += msg.chunk;
            if (msg.stageId === 'task-polish' && isPolishAssistantVisible()) {
              document.getElementById('polish-loading').style.display = 'none';
              const edit = document.getElementById('polish-result-edit');
              edit.style.display = 'block';
              edit.value += msg.chunk;
              document.getElementById('btn-polish-apply').disabled = !edit.value.trim();
              syncPolishResultHeight();
            } else if (inputBusyOp === 'workflow') {
              renderGenStatusDetail();
              scrollChatPanelToBottom();
            }
          } else if (msg.stageId === currentRunStageId) {
            document.getElementById('output').textContent += msg.chunk;
          }
          break;
        case 'downstreamReset':
          renderDownstreamResetPanel(msg);
          break;
        case 'stageArtifactHints':
          stageArtifacts[msg.stageId] = msg.artifacts || [];
          if (currentPausedStageId === msg.stageId) {
            const uiState = syncPauseBarVisibility();
            if (uiState.showPauseBar) {
              renderPauseBar(msg.stageId, uiState);
            }
          }
          break;
        case 'stageError':
          renderStageErrorCard(msg);
          stageStatus[msg.stageId] = 'error';
          renderExecTimeline();
          break;
        default:
          break;
      }
    });

    function selectConfirmStage(stageId) {
      selectedStageId = stageId;
      const ul = document.getElementById('timeline');
      [...ul.children].forEach((c) => c.classList.toggle('selected', c.dataset.id === stageId));
      document.querySelectorAll('.plan-stage-card').forEach((c) => {
        c.classList.toggle('selected', c.dataset.stageId === stageId);
      });
      const card = document.querySelector('.plan-stage-card[data-stage-id="' + stageId.replace(/"/g, '') + '"]');
      if (card && card.scrollIntoView) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      showConfirmDetail();
    }

    function renderConfirmFooter() {
      const el = document.getElementById('confirm-stats');
      if (!workflowDef || !workflowDef.stages) {
        el.innerHTML = '';
        return;
      }
      const counts = countStagesByKind(workflowDef.stages);
      const lines = buildConfirmStatsLines({
        taskType: workflowDef.meta?.taskType,
        ...counts,
      });
      el.innerHTML = lines.map((line) => '<span>' + escapeHtml(line) + '</span>').join('');
    }

    function renderPlanArtifactsPanel() {
      const el = document.getElementById('plan-artifacts');
      if (!workflowDef || !workflowDef.stages) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      const paths = collectArtifactPathsFromStages(workflowDef.stages);
      if (paths.length === 0) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
      }
      const warnings = getArtifactHeuristicWarnings(paths, workflowDef.stages);
      let html = '<h4>将落盘的工作区文件（' + paths.length + '）</h4><ul>';
      for (const p of paths) {
        html += '<li><code>' + escapeHtml(p) + '</code></li>';
      }
      html += '</ul>';
      for (const w of warnings) {
        html += '<div class="artifact-warn">⚠ ' + escapeHtml(w) + '</div>';
      }
      el.innerHTML = html;
      el.style.display = 'block';
    }

    function renderPlanStageCards() {
      const container = document.getElementById('plan-stage-cards');
      container.innerHTML = '';
      if (!workflowDef || !workflowDef.stages || workflowDef.stages.length === 0) {
        return;
      }
      const phaseMap = {};
      const phaseOrder = [];
      workflowDef.stages.forEach((s, i) => {
        const phase = parsePhaseFromTitle(s.title) || '';
        if (!phaseMap[phase]) {
          phaseMap[phase] = [];
          phaseOrder.push(phase);
        }
        phaseMap[phase].push({ s, i });
      });
      const hasPhases = phaseOrder.some((p) => p !== '');
      let html = '';
      for (const phase of phaseOrder) {
        if (hasPhases && phase) {
          html += '<div class="plan-phase-header">' + escapeHtml(phase) + '</div>';
        }
        for (const { s } of phaseMap[phase]) {
          const displayTitle = stripPhasePrefix(s.title);
          const artifactPath = getStageArtifactPath(s);
          const tags = ['<span class="tag">' + escapeHtml(s.tool) + '</span>'];
          if (s.isDecisionStage) {
            tags.push('<span class="tag decision">决策</span>');
          }
          if (s.pauseAfter) {
            tags.push('<span class="tag pause">⏸ 审核</span>');
          }
          let cardHtml =
            '<div class="plan-stage-card' +
            (s.id === selectedStageId ? ' selected' : '') +
            '" data-stage-id="' +
            escapeHtml(s.id) +
            '" role="button" tabindex="0">' +
            '<div class="card-title">' +
            escapeHtml(displayTitle) +
            '</div>' +
            '<div class="card-tags">' +
            tags.join('') +
            '</div>';
          if (artifactPath) {
            cardHtml += '<div class="artifact-line">📄 ' + escapeHtml(artifactPath) + '</div>';
          }
          if (s.aiTip && String(s.aiTip).trim()) {
            cardHtml +=
              '<div class="card-aitip">💡 ' + escapeHtml(truncateConfirmText(String(s.aiTip), 120)) + '</div>';
          }
          cardHtml += '</div>';
          html += cardHtml;
        }
      }
      container.innerHTML = html;
      container.querySelectorAll('.plan-stage-card').forEach((card) => {
        const sid = card.getAttribute('data-stage-id');
        if (!sid) {
          return;
        }
        card.addEventListener('click', () => selectConfirmStage(sid));
        card.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            selectConfirmStage(sid);
          }
        });
      });
    }

    function renderConfirmTimeline() {
      const ul = document.getElementById('timeline');
      ul.innerHTML = '';
      for (const st of workflowDef.stages) {
        const li = document.createElement('li');
        li.textContent = stripPhasePrefix(st.title);
        const badge = document.createElement('span');
        badge.className = 'badge decision';
        badge.textContent = st.isDecisionStage ? '决策' : '';
        li.appendChild(badge);
        li.dataset.id = st.id;
        if (st.id === selectedStageId) li.classList.add('selected');
        li.onclick = () => selectConfirmStage(st.id);
        ul.appendChild(li);
      }
    }

    function showConfirmDetail() {
      const st = workflowDef.stages.find((s) => s.id === selectedStageId);
      const el = document.getElementById('detail');
      if (!st) return (el.textContent = '');
      const lines = [];
      if (st.aiTip && String(st.aiTip).trim()) {
        lines.push('审核提示：' + String(st.aiTip).trim());
      }
      lines.push(st.description || '(无描述)', '工具：' + st.tool, 'pauseAfter：' + String(st.pauseAfter));
      const artifactPath = getStageArtifactPath(st);
      if (artifactPath) {
        lines.push('落盘路径：' + artifactPath);
      }
      if (workflowDef.meta?.taskType) {
        lines.push('任务类型（meta.taskType）：' + workflowDef.meta.taskType);
      }
      lines.push(...formatGlobalConfigSummaryForConfirm(workflowDef.globalConfig));
      if (stageSourceSummary && stageSourceSummary.length) {
        lines.push(...formatStageSourceSummaryLines(stageSourceSummary, st.id));
      }
      el.textContent = lines.join('\\n');
    }

    function renderDownstreamResetPanel(msg) {
      const el = document.getElementById('downstream-reset-panel');
      el.style.display = 'block';
      el.innerHTML = '';
      el.className = 'downstream-reset-panel';
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = '已重置下游阶段（决策重试）';
      details.appendChild(summary);
      const stageList = document.createElement('ul');
      (msg.resetStageTitles || []).forEach((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        stageList.appendChild(li);
      });
      details.appendChild(stageList);
      if (msg.rolledBackFiles && msg.rolledBackFiles.length) {
        const rolledTitle = document.createElement('div');
        rolledTitle.textContent = '已回滚文件：';
        rolledTitle.style.marginTop = '8px';
        details.appendChild(rolledTitle);
        const fileList = document.createElement('ul');
        msg.rolledBackFiles.forEach((f) => {
          const li = document.createElement('li');
          li.textContent = f;
          fileList.appendChild(li);
        });
        details.appendChild(fileList);
      }
      if (msg.rollbackFailed && msg.rollbackFailed.length) {
        const err = document.createElement('div');
        err.className = 'error';
        err.textContent =
          '回滚失败：' + msg.rollbackFailed.map((x) => x.filePath + ': ' + x.error).join('；');
        err.style.marginTop = '8px';
        details.appendChild(err);
      }
      el.appendChild(details);
    }

    function collectArtifactHintsForStage(stageId) {
      const hints = (stageArtifacts[stageId] || []).slice();
      const st = workflowDef?.stages?.find((s) => s.id === stageId);
      if (st?.tool === 'llm-text' && st.toolConfig?.writeOutputToFile) {
        const rel = st.toolConfig.writeOutputToFile;
        if (!hints.some((h) => h.filePath === rel || h.filePath.endsWith('/' + rel))) {
          hints.push({ filePath: rel, canDiff: false });
        }
      }
      if (st?.tool === 'file-write' && st.toolConfig?.filePath) {
        const rel = st.toolConfig.filePath;
        if (!hints.some((h) => h.filePath === rel || h.filePath.endsWith('/' + rel))) {
          hints.push({ filePath: rel, canDiff: false });
        }
      }
      return hints;
    }

    function appendStageArtifactActions(bar, stageId) {
      const hints = collectArtifactHintsForStage(stageId);
      if (!hints.length) return;
      const row = document.createElement('div');
      row.className = 'artifact-row';
      const label = document.createElement('span');
      label.className = 'muted';
      label.textContent = '落盘文件：';
      row.appendChild(label);
      hints.forEach((h) => {
        const base = (h.filePath.split('/').pop() || h.filePath);
        const viewBtn = document.createElement('button');
        viewBtn.className = 'secondary';
        viewBtn.textContent = '📄 查看 ' + base;
        viewBtn.onclick = () => vscode.postMessage({ type: 'openArtifactFile', stageId, filePath: h.filePath });
        row.appendChild(viewBtn);
        if (h.canDiff) {
          const diffBtn = document.createElement('button');
          diffBtn.className = 'secondary';
          diffBtn.textContent = '↔ 对比变更';
          diffBtn.onclick = () => vscode.postMessage({ type: 'openArtifactDiff', stageId, filePath: h.filePath });
          row.appendChild(diffBtn);
        }
        if (h.state) {
          const badge = document.createElement('span');
          badge.className = 'muted';
          badge.textContent = '[' + h.state + ']';
          row.appendChild(badge);
        }
      });
      bar.appendChild(row);
    }

    function formatConfidenceBar(score) {
      const n = Math.max(0, Math.min(5, Math.round(Number(score) * 5)));
      return '[' + '■'.repeat(n) + '□'.repeat(5 - n) + '] ' + Number(score).toFixed(2);
    }

    function confidenceWarn(level) {
      return level === 'low' || level === 'critical' ? ' ⚠' : '';
    }

    function renderExecTimeline() {
      const ul = document.getElementById('timeline-exec');
      ul.innerHTML = '';
      const icon = (s) =>
        ({ pending: '⏳', running: '⚡', 'waiting-questions': '❓', paused: '👀', done: '✅', skipped: '⏭', error: '❌', retrying: '🔄' }[s] || '⏳');
      for (const st of workflowDef.stages) {
        const li = document.createElement('li');
        const s = stageStatus[st.id] || 'pending';
        li.textContent = icon(s) + ' ' + st.title;
        if (st.isDecisionStage) {
          const sp = document.createElement('span');
          sp.className = 'badge decision';
          sp.textContent = '决策';
          li.appendChild(sp);
        }
        const conf = stageConfidence[st.id];
        if (conf && typeof conf.score === 'number' && !Number.isNaN(conf.score)) {
          const confSpan = document.createElement('span');
          confSpan.className = 'confidence conf-' + (conf.level || 'medium');
          confSpan.textContent = formatConfidenceBar(conf.score) + confidenceWarn(conf.level);
          confSpan.title = (conf.reasons || []).join('\\n');
          li.appendChild(confSpan);
        }
        ul.appendChild(li);
      }
    }

    function resetExecUi() {
      Object.keys(stageStatus).forEach((k) => delete stageStatus[k]);
      Object.keys(stageOutputs).forEach((k) => delete stageOutputs[k]);
      Object.keys(stageConfidence).forEach((k) => delete stageConfidence[k]);
      Object.keys(stageArtifacts).forEach((k) => delete stageArtifacts[k]);
      document.getElementById('done-banner').style.display = 'none';
      const drp = document.getElementById('downstream-reset-panel');
      drp.style.display = 'none';
      drp.innerHTML = '';
      const fb = document.getElementById('fail-banner');
      fb.style.display = 'none';
      fb.textContent = '';
      fb.className = 'banner error';
      document.getElementById('output').textContent = '';
      currentPausedStageId = null;
      currentBeforeQuestionStageId = null;
      Object.keys(beforeQuestionsByStage).forEach((k) => delete beforeQuestionsByStage[k]);
      syncPauseBarVisibility();
      syncOutputVisibility();
    }

    function getQuestionAfter(stageId) {
      const st = workflowDef?.stages?.find((s) => s.id === stageId);
      return st?.questionAfter ?? [];
    }

    function renderAfterQuestionsCard(stageId, questions) {
      const bar = document.getElementById('pause-bar');
      bar.innerHTML = '';
      document.getElementById('output-label').textContent = '⏸ 执行后追问：' + stageId;

      const title = document.createElement('div');
      title.className = 'muted';
      title.textContent = 'AI 在本阶段输出后需要补充以下信息（可多题一并填写）：';
      bar.appendChild(title);

      const answers = {};
      (questions || []).forEach((q, idx) => {
        const block = document.createElement('div');
        block.style.marginTop = '10px';
        const qId = String(q.id || ('after_q_' + (idx + 1)));
        const qText = String(
          q.text || q.question || q.prompt || q.title || q.hint || ('请补充问题 ' + (idx + 1)),
        );

        const qTitle = document.createElement('div');
        qTitle.textContent = '问题 ' + (idx + 1) + '：' + qText + (q.required === false ? '' : ' *');
        block.appendChild(qTitle);

        if (q.hint) {
          const hint = document.createElement('div');
          hint.className = 'muted';
          hint.textContent = '💡 ' + q.hint;
          block.appendChild(hint);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = q.hint || '请输入答案';
        input.oninput = () => {
          answers[qId] = input.value || '';
        };
        block.appendChild(input);
        bar.appendChild(block);
      });

      const btn = document.createElement('button');
      btn.textContent = '提交答案并继续';
      btn.onclick = () => {
        vscode.postMessage(buildAnswerQuestionsMessage(stageId, answers));
      };
      bar.appendChild(btn);
    }

    function appendQuestionProvenanceBadge(block, provenance, ruleRefs) {
      if (!provenance) return;
      const refs = Array.isArray(ruleRefs) && ruleRefs.length > 0 ? ' · R#' + ruleRefs.join(',R#') : '';
      const labels = {
        charter_direct: '主旨直接命中',
        charter_inferred: '主旨推导',
        escalated: '须人工确认',
        human: '人工',
      };
      const badge = document.createElement('span');
      badge.className = 'question-provenance-badge decision-provenance-badge';
      badge.dataset.provenance = provenance;
      badge.textContent = (labels[provenance] || provenance) + refs;
      block.appendChild(badge);
    }

    function renderBeforeQuestionsCard(stageId, questions) {
      const bar = document.getElementById('pause-bar');
      bar.innerHTML = '';
      document.getElementById('output-label').textContent = '⏸ 执行前确认：' + stageId;

      const hasSuggest = (questions || []).some((q) => String(q.suggestedAnswer ?? '').trim());
      const title = document.createElement('div');
      title.className = 'muted';
      title.textContent = hasSuggest
        ? '以下为主旨推荐答案，请确认或修改后提交：'
        : 'AI 在执行此阶段前需要确认以下信息：';
      bar.appendChild(title);

      const answers = {};
      (questions || []).forEach((q, idx) => {
        const block = document.createElement('div');
        block.className = 'question-field';
        block.style.marginTop = '10px';
        if (q.provenance === 'charter_inferred') {
          block.classList.add('question-field-charter-inferred');
        } else if (q.provenance === 'charter_direct') {
          block.classList.add('question-field-charter-direct');
        }
        const qId = String(q.id || ('before_q_' + (idx + 1)));
        const qText = String(
          q.text || q.question || q.prompt || q.title || q.hint || ('请补充问题 ' + (idx + 1)),
        );

        const qTitle = document.createElement('div');
        qTitle.textContent = '问题 ' + (idx + 1) + '：' + qText + (q.required === false ? '' : ' *');
        block.appendChild(qTitle);
        appendQuestionProvenanceBadge(block, q.provenance, q.ruleRefs);

        if (q.hint) {
          const hint = document.createElement('div');
          hint.className = 'muted';
          hint.textContent = '💡 ' + q.hint;
          block.appendChild(hint);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = q.hint || '请输入答案';
        const suggested = String(q.suggestedAnswer ?? '').trim();
        if (suggested) {
          input.value = suggested;
          answers[qId] = suggested;
        }
        input.oninput = () => {
          answers[qId] = input.value || '';
        };
        block.appendChild(input);
        bar.appendChild(block);
      });

      const btn = document.createElement('button');
      btn.textContent = '开始执行';
      btn.onclick = () => {
        vscode.postMessage(buildAnswerQuestionsBeforeMessage(stageId, answers));
      };
      bar.appendChild(btn);
    }

    function renderDecisionChecklist(container, decisionText) {
      const panel = document.createElement('div');
      panel.className = 'q-panel';
      panel.innerHTML = '<strong>AI 质量建议面板</strong>';

      const scenarioCount = (decisionText.match(/场景\\s*[0-9一二三四五六七八九十]/g) || []).length;
      const hasConflictCheck = /已检查：|潜在冲突：/.test(decisionText);
      const checks = [
        /而非|备选|不选/.test(decisionText),
        scenarioCount >= 2,
        /AI 无法验证的假设/.test(decisionText),
        decisionText.length <= 800,
        !/function\\s|class\\s|const\\s|let\\s|var\\s|=>/.test(decisionText),
        hasConflictCheck,
      ];
      const labels = [
        '每条决策是否说明了“为什么不选备选方案”？',
        '“边界压力测试”节是否包含至少 2 个具体场景？',
        '“AI 无法验证的假设”节是否至少有 1 条？',
        '总字数是否 ≤ 800 字？',
        '是否包含了代码（不应该有）？',
        '若涉及已有代码，是否标注了冲突检测结果？',
      ];

      labels.forEach((label, i) => {
        const row = document.createElement('label');
        row.className = 'q-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checks[i];
        cb.onclick = (e) => e.stopPropagation();
        const text = document.createElement('span');
        text.textContent = label;
        row.appendChild(cb);
        row.appendChild(text);
        panel.appendChild(row);
      });
      container.appendChild(panel);
    }

    function renderPauseBar(stageId, uiState) {
      const bar = document.getElementById('pause-bar');
      bar.innerHTML = '';
      const outputText = stageOutputs[stageId] ?? document.getElementById('output').textContent ?? '';
      const decision = uiState.mode === 'decision';

      if (decision) {
        document.getElementById('output-label').textContent = '📋 决策审核：' + stageId;
        const title = document.createElement('div');
        title.textContent = 'AI 提出了以下设计决策。你的修改将直接约束后续代码。';
        title.className = 'muted';
        bar.appendChild(title);

        if (shouldShowPlanReviewChecklist(workflowDef, stageId, workflowWarnings, planSummary)) {
          const planPanel = document.createElement('div');
          planPanel.className = 'plan-review-panel';
          planPanel.textContent = buildPlanReviewChecklistLines(workflowDef, planSummary, workflowWarnings).join('\\n');
          bar.appendChild(planPanel);
        }

        const approvedCount = approvedDecisionCount();
        let decisionSummaryEl = null;

        if (shouldShowDecisionConflictBanner(approvedCount)) {
          const banner = document.createElement('div');
          banner.style.marginTop = '8px';
          banner.style.padding = '8px';
          banner.style.border = '1px solid var(--vscode-widget-border)';
          banner.style.borderRadius = '4px';
          banner.textContent = 'ℹ️ 本工作流已有 ' + approvedCount + ' 个已批准的决策清单，建议批准前核对模块间约束是否一致。';
          const viewBtn = document.createElement('button');
          viewBtn.className = 'secondary';
          viewBtn.style.marginLeft = '8px';
          viewBtn.textContent = '查看已批准的决策 ↗';
          banner.appendChild(viewBtn);
          decisionSummaryEl = document.createElement('div');
          decisionSummaryEl.style.display = 'none';
          decisionSummaryEl.style.marginTop = '8px';
          viewBtn.onclick = () => {
            if (decisionSummaryEl.style.display === 'none') {
              decisionSummaryEl.innerHTML = '';
              (workflowDef?.stages ?? [])
                .filter((s) => s.isDecisionStage && stageStatus[s.id] === 'done')
                .forEach((s) => {
                  const d = document.createElement('details');
                  const summary = document.createElement('summary');
                  summary.textContent = s.title;
                  d.appendChild(summary);
                  const pre = document.createElement('pre');
                  pre.style.whiteSpace = 'pre-wrap';
                  pre.textContent = String(stageOutputs[s.id] ?? '(无已批准决策内容)');
                  d.appendChild(pre);
                  decisionSummaryEl.appendChild(d);
                });
              decisionSummaryEl.style.display = 'block';
            } else {
              decisionSummaryEl.style.display = 'none';
            }
          };
          bar.appendChild(banner);
        }

        const editor = document.createElement('textarea');
        editor.id = 'decision-editor';
        editor.value = outputText;

        const retryPrompt = document.createElement('input');
        retryPrompt.type = 'text';
        retryPrompt.placeholder = '重试提示（可选）：例如“请补充边界压力测试并压缩到 800 字内”';

        const btnRetry = document.createElement('button');
        btnRetry.className = 'secondary';
        btnRetry.textContent = '🔄 让 AI 重新生成';
        btnRetry.disabled = !uiState.enableRetry;
        btnRetry.onclick = () => {
          if (!uiState.enableRetry) return;
          const approvedCount = approvedDecisionCount();
          if (shouldAskRetryConfirm(approvedCount)) {
            const ok = confirm('重新生成此决策将导致 N 个下游阶段重新执行，是否继续？');
            if (!canProceedRetry(approvedCount, ok)) return;
          }
          vscode.postMessage({ type: 'retry', stageId, comment: retryPrompt.value || '' });
        };

        const btnApprove = document.createElement('button');
        btnApprove.textContent = '✅ 批准此决策';
        btnApprove.disabled = !uiState.enableApproveDecision;
        const qualityWarn = document.createElement('div');
        qualityWarn.style.display = 'none';
        qualityWarn.style.marginTop = '8px';
        qualityWarn.style.padding = '8px';
        qualityWarn.style.border = '1px solid var(--vscode-editorWarning-foreground)';
        qualityWarn.style.borderRadius = '4px';
        const qualityWarnText = document.createElement('span');
        qualityWarn.appendChild(qualityWarnText);
        const forceApproveBtn = document.createElement('button');
        forceApproveBtn.className = 'secondary';
        forceApproveBtn.style.marginLeft = '8px';
        forceApproveBtn.textContent = '忽略，直接批准';
        qualityWarn.appendChild(forceApproveBtn);

        const doApprove = () =>
          uiState.enableApproveDecision &&
          vscode.postMessage({ type: 'approveDecision', stageId, decisionRecord: editor.value });
        const countChecks = () => {
          const boxes = Array.from(bar.querySelectorAll('.q-panel input[type=checkbox]'));
          const checked = boxes.filter((b) => b.checked).length;
          return { total: boxes.length, checked };
        };

        btnApprove.onclick = () => {
          const counts = countChecks();
          if (getDecisionApproveAction(counts.total, counts.checked) === 'show-soft-prompt') {
            const left = getUncheckedCount(counts.total, counts.checked);
            qualityWarnText.textContent = '建议先完成右侧质量核查（还有 ' + left + ' 条未确认），或者直接批准。';
            qualityWarn.style.display = 'block';
            return;
          }
          qualityWarn.style.display = 'none';
          doApprove();
        };
        forceApproveBtn.onclick = () => {
          qualityWarn.style.display = 'none';
          doApprove();
        };

        bar.appendChild(title);
        bar.appendChild(editor);
        bar.appendChild(retryPrompt);
        bar.appendChild(btnRetry);
        bar.appendChild(btnApprove);
        renderDecisionChecklist(bar, editor.value);
        bar.appendChild(qualityWarn);
        if (decisionSummaryEl) {
          bar.appendChild(decisionSummaryEl);
        }
        editor.oninput = () => {
          const old = bar.querySelector('.q-panel');
          if (old) old.remove();
          renderDecisionChecklist(bar, editor.value);
        };
        return;
      }

      document.getElementById('output-label').textContent = '👀 等待审核：' + stageId;
      appendStageArtifactActions(bar, stageId);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = '修改意见（可选）';
      const btnRetry = document.createElement('button');
      btnRetry.className = 'secondary';
      btnRetry.textContent = '🔄 修改后重新生成';
      btnRetry.disabled = !uiState.enableRetry;
      btnRetry.onclick = () => vscode.postMessage({ type: 'retry', stageId, comment: inp.value || '' });
      const btnApprove = document.createElement('button');
      btnApprove.textContent = '✅ 批准，继续';
      btnApprove.disabled = !uiState.enableApprove;
      btnApprove.onclick = () => uiState.enableApprove && vscode.postMessage({ type: 'approve', stageId });
      bar.appendChild(inp);
      bar.appendChild(btnRetry);
      bar.appendChild(btnApprove);
    }`;
}
