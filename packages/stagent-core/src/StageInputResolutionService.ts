import type * as vscode from './platform/HostTypes';
import type { Stage, StageRuntime, WorkflowInstance, BackendMessage } from './WorkflowDefinition';
import {
  appendGlobalDecisionContextToSystemPrompt,
  buildGlobalDecisionSystemPromptBlock,
} from './GlobalDecisionContext';
import {
  DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS,
  DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
  resolveStageInput,
  type InputResolverContext,
} from './WorkflowInputResolver';
import { DEFAULT_FS_READ_TIMEOUT_MS, pathExists, readTextFile } from './FsAsync';
import type { LlmClient } from './LlmClient';
import {
  readEngineGlobalDecisionInjectMode,
  readEngineInjectApprovedDecisionContext,
} from './WorkflowEngineSettingsReaders';
import { emitStageError, llmContextOverflowStageError } from './WorkflowStageErrorHelpers';
import type { WorkflowEnginePathHost } from './WorkflowEnginePathHost';
import { LOG_PREVIEW_INPUT_SUMMARY_FALLBACK } from './LogPreviewLimits';
import {
  INPUT_CONTEXT_SUMMARY_TARGET_MAX_CHARS,
  INPUT_CONTEXT_SUMMARY_TARGET_MIN_CHARS,
} from './workflow/DecisionContentLimits';
import { augmentSystemPromptWithCharterConstraints } from './charter/CharterContextService';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import {
  DEBUG_EVENT_CHARTER_CONSTRAINTS_INJECT,
  DEBUG_EVENT_DEGRADE_MODE_SWITCH,
  DEBUG_EVENT_GLOBAL_DECISION_CONTEXT_INJECT,
  DEBUG_EVENT_INPUT_SUMMARY_FALLBACK,
} from './DebugLogEvents';

export interface StageInputResolutionDeps {
  getInstance: () => WorkflowInstance | undefined;
  getPathHost: () => WorkflowEnginePathHost;
  llm: LlmClient;
  warn: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: BackendMessage) => void;
  getWorkspaceRootAbsolute: () => string | undefined;
  /** 可选：输入上下文降级时上报（kind=context_degrade），供 MetricsCollector 聚合。 */
  logUserAction?: (kind: string, detail: Record<string, unknown>) => void;
}

const INPUT_TRUNCATE_TOKENS = DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS;
const INPUT_TOTAL_LIMIT_TOKENS = DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS;

export class StageInputResolutionService {
  constructor(private readonly deps: StageInputResolutionDeps) {}

  async resolveInput(stage: Stage, runtime: StageRuntime, panel: vscode.WebviewPanel): Promise<string> {
    const inst = this.deps.getInstance();
    if (!inst) {
      return '';
    }
    const ctx: InputResolverContext = {
      definition: inst.definition,
      stageRuntimes: inst.stageRuntimes,
      taskDir: inst.taskDir,
      workspaceRoot: this.deps.getWorkspaceRootAbsolute(),
    };
    return resolveStageInput(ctx, stage, runtime, {
      readFileText: async (absPath) =>
        readTextFile(absPath, { timeoutMs: DEFAULT_FS_READ_TIMEOUT_MS }),
      fileExists: async (absPath) => pathExists(absPath),
      safeJoinUnderWorkspaceRoot: (root, rel) =>
        this.deps.getPathHost().safeJoinUnderWorkspaceRoot(root, rel),
      warn: (message) => this.deps.warn(message),
      debugLog: (stageId, event, attempt, payload) =>
        this.deps.debugLog(stageId, event, attempt, payload),
      summarizeForInput: (stageId, label, raw) => this.summarizeForInput(stageId, label, raw),
      postMessage: (msg) => this.deps.postMessage(panel, msg),
      onContextOverflow: (st, _rt, totalTokens, totalLimit) => {
        emitStageError(
          panel,
          (p, msg) => this.deps.postMessage(panel, msg),
          inst,
          llmContextOverflowStageError(
            st.id,
            `输入上下文过长：估算 ${totalTokens} tokens，超过 ${totalLimit}`,
          ),
        );
      },
      recordContextDegrade: (info) =>
        this.deps.logUserAction?.('context_degrade', { ...info }),
      truncateTokens: INPUT_TRUNCATE_TOKENS,
      totalTokenLimit: INPUT_TOTAL_LIMIT_TOKENS,
    });
  }

  async summarizeForInput(stageId: string, label: string, raw: string): Promise<string> {
    const prompt = `请将以下内容压缩为 ${INPUT_CONTEXT_SUMMARY_TARGET_MIN_CHARS}-${INPUT_CONTEXT_SUMMARY_TARGET_MAX_CHARS} 字中文摘要，保留关键决策、接口约束、风险点；不要代码块。\n\n标签：${label}\n\n原文：\n${raw}`;
    const trimmed = await this.deps.llm.summarizeText(stageId, prompt);
    if (!trimmed) {
      this.deps.warn(`input-summary-failed stage=${stageId} label=${label} fallback=truncate`);
      this.deps.debugLog(stageId, DEBUG_EVENT_INPUT_SUMMARY_FALLBACK, 0, { label });
      return raw.slice(0, LOG_PREVIEW_INPUT_SUMMARY_FALLBACK);
    }
    this.deps.warn(`input-degrade-summary stage=${stageId} label=${label}`);
    this.deps.debugLog(stageId, DEBUG_EVENT_DEGRADE_MODE_SWITCH, 0, { label, to: 'summary' });
    return trimmed;
  }

  augmentSystemPromptWithGlobalDecisions(
    stage: Stage,
    runtime: StageRuntime,
    systemPrompt: string,
  ): string {
    const inst = this.deps.getInstance();
    if (!inst) {
      return systemPrompt;
    }
    const block = buildGlobalDecisionSystemPromptBlock(inst.definition, inst.stageRuntimes, stage, {
      workflowInjectFlag: inst.definition.globalConfig?.injectApprovedDecisionContext,
      vscodeInjectEnabled: readEngineInjectApprovedDecisionContext(inst.definition.globalConfig),
      mode: readEngineGlobalDecisionInjectMode(inst.definition.globalConfig),
    });
    if (block) {
      const mode = readEngineGlobalDecisionInjectMode(inst.definition.globalConfig);
      this.deps.debugLog(stage.id, DEBUG_EVENT_GLOBAL_DECISION_CONTEXT_INJECT, runtime.retryCount + 1, {
        target: 'systemPrompt',
        mode,
        chars: block.length,
      });
    }
    let prompt = appendGlobalDecisionContextToSystemPrompt(systemPrompt, block);
    const charterAug = augmentSystemPromptWithCharterConstraints(
      prompt,
      this.deps.getWorkspaceRootAbsolute(),
      getStagentConfiguration(),
    );
    if (charterAug.block) {
      this.deps.debugLog(stage.id, DEBUG_EVENT_CHARTER_CONSTRAINTS_INJECT, runtime.retryCount + 1, {
        target: 'systemPrompt',
        chars: charterAug.block.length,
      });
    }
    prompt = charterAug.prompt;
    return prompt;
  }
}
