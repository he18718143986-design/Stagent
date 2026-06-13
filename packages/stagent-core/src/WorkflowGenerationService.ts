/**
 * M42：工作流生成服务 — polish / clarify / generate 全链（含 parse / normalize / 序号防覆盖）。
 */
import * as crypto from 'crypto';
import type { WebviewPanel, ExtensionContext, WorkspaceConfiguration } from './platform/HostTypes';
import type { WorkflowDefinition } from './WorkflowDefinition';
import {
  normalizeWorkflow as normalizeWorkflowDefinition,
  parseWorkflowJson as parseWorkflowJsonFromRaw,
} from './WorkflowGeneration';
import {
  handleGenerateClarifyQuestions,
  handlePolishUserTask,
  POLISH_CACHE_MAX,
} from './WorkflowPreGenerationCoordinator';
import { runWorkflowGeneration } from './WorkflowGenerationRunner';
import {
  buildGenerationRunnerHost,
  buildPreGenerationHost,
} from './engine-wiring/buildGenerationHosts';
import type { EngineHostFactoryDeps } from './engine-host';
import type { PolishTierRequest } from './polish/PolishTier';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import {
  readEngineAutoInsertGlobalArchitectureDecision,
  readEngineGenerateWorkflowSettings,
  readEngineGlossaryEnabled,
  readEngineSplitTestRunBundledCommands,
} from './WorkflowEngineSettingsReaders';
import { confirmLargeProjectGeneration } from './generation/generationGuards';
import type { ConfirmDialog } from './generation/confirmDialogAdapter';
import {
  readZoomOutGlossaryHint,
  shouldUpgradeZoomOutStage,
} from './generation/normalizeWorkflowContext';
import type { WorkflowEngineGenerationFacade } from './engine-facades/WorkflowEngineFacades';
import type { GenerationUiPort } from './engine-wiring/GenerationUiPort';
import { DEBUG_EVENT_GENERATION_SUPERSEDED } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';

export interface WorkflowGenerationServiceHooks {
  ui: GenerationUiPort;
  confirmDialog: ConfirmDialog;
  hostFactoryDeps: () => EngineHostFactoryDeps;
  invokeLlmRaw: (
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel,
    traceStageId: string,
    opts?: import('./core/LlmInvokeOpts').LlmInvokeOpts,
  ) => Promise<string>;
  pickZoomOutFilePath: (preferred?: string) => string;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  degraded: (reason: string, context?: Record<string, unknown>) => void;
}

/** 生成序号 + 润色缓存 + 三入口 API。 */
export class WorkflowGenerationService implements WorkflowEngineGenerationFacade {
  private generationSeq = 0;
  private readonly polishCache = new Map<string, { text: string; polishedAt: string }>();

  constructor(private readonly hooks: WorkflowGenerationServiceHooks) {}

  setUi(ui: GenerationUiPort): void {
    this.hooks.ui = ui;
  }

  bumpGenerationSeq(): number {
    return ++this.generationSeq;
  }

  getGenerationSeq(): number {
    return this.generationSeq;
  }

  isGenerationSuperseded(myGen: number): boolean {
    if (myGen !== this.generationSeq) {
      this.hooks.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_GENERATION_SUPERSEDED, 0, {
        myGen,
        current: this.generationSeq,
      });
      return true;
    }
    return false;
  }

  polishCacheKey(draft: string, taskType: string, polishTier: 'light' | 'standard'): string {
    return crypto.createHash('sha256').update(`${taskType}\n${polishTier}\n${draft}`, 'utf8').digest('hex');
  }

  rememberPolishCache(cacheKey: string, text: string, polishedAt: string): void {
    if (this.polishCache.size >= POLISH_CACHE_MAX) {
      const first = this.polishCache.keys().next().value as string | undefined;
      if (first) {
        this.polishCache.delete(first);
      }
    }
    this.polishCache.set(cacheKey, { text, polishedAt });
  }

  getPolishCache(): Map<string, { text: string; polishedAt: string }> {
    return this.polishCache;
  }

  private preGenerationHost() {
    return buildPreGenerationHost(this.hooks.hostFactoryDeps());
  }

  private generationRunnerHost() {
    return buildGenerationRunnerHost(this.hooks.hostFactoryDeps());
  }

  async polishUserTask(
    draft: string,
    taskType: string,
    panel: WebviewPanel,
    taskWorkspacePathRaw?: string,
    polishTier?: PolishTierRequest,
  ): Promise<void> {
    return handlePolishUserTask(
      this.preGenerationHost(),
      draft,
      taskType,
      panel,
      taskWorkspacePathRaw,
      polishTier ?? 'auto',
    );
  }

  async generateClarifyQuestions(
    userInput: string,
    taskType: string,
    taskWorkspacePathRaw: string,
    panel: WebviewPanel,
  ): Promise<void> {
    return handleGenerateClarifyQuestions(
      this.preGenerationHost(),
      userInput,
      taskType,
      taskWorkspacePathRaw,
      panel,
    );
  }

  async generateWorkflow(
    userInput: string,
    taskType: string,
    panel: WebviewPanel,
    taskWorkspacePathRaw: string,
    polishContext?: { originalDraft: string; polishedAt: string },
    clarifyAnswers?: Record<string, string>,
  ): Promise<void> {
    if (!(await confirmLargeProjectGeneration(userInput, this.hooks.confirmDialog))) {
      this.hooks.ui.postMessage(panel, { type: 'generationCancelled' });
      return;
    }
    const myGen = this.bumpGenerationSeq();
    return runWorkflowGeneration(this.generationRunnerHost(), {
      myGen,
      userInput,
      taskType,
      panel,
      taskWorkspacePathRaw,
      polishContext,
      clarifyAnswers,
      ...readEngineGenerateWorkflowSettings(),
    });
  }

  async parseWorkflowJson(
    raw: string,
    panel: WebviewPanel,
    onAuxLlmOutput?: (text: string) => void,
    maxOutputTokens?: number,
  ): Promise<WorkflowDefinition> {
    return parseWorkflowJsonFromRaw(raw, {
      invokeLlmRaw: (systemPrompt, userContent, traceStageId, opts) =>
        this.hooks.invokeLlmRaw(systemPrompt, userContent, panel, traceStageId, opts),
      onAuxLlmOutput,
      maxOutputTokens,
    });
  }

  normalizeWorkflow(wf: WorkflowDefinition, userInput: string, taskType: string): WorkflowDefinition {
    const cfg = getStagentConfiguration();
    const upgradeZoomOut = shouldUpgradeZoomOutStage(wf, taskType);
    const zoomOutGlossaryHint = upgradeZoomOut
      ? readZoomOutGlossaryHint(wf, readEngineGlossaryEnabled(), (reason, context) =>
          this.hooks.degraded(reason, context),
        )
      : undefined;
    return normalizeWorkflowDefinition(wf, userInput, taskType, {
      pickZoomOutFilePath: (preferred) => this.hooks.pickZoomOutFilePath(preferred),
      autoInsertGlobalArchitectureDecision: readEngineAutoInsertGlobalArchitectureDecision(cfg),
      splitTestRunBundledCommands: readEngineSplitTestRunBundledCommands(cfg),
      upgradeZoomOut,
      zoomOutGlossaryHint,
    });
  }
}
