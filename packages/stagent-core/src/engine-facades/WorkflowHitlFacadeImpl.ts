import type * as vscode from '../platform/HostTypes';
import type { WorkflowEngineHitlFacade } from './WorkflowEngineFacades';
import type { WorkflowEngineDiagnostics } from '../WorkflowEngineDiagnostics';
import type { WorkflowEngineHostRegistry } from '../WorkflowEngineHostRegistry';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import { applyOutputEdit } from '../WorkflowEngineOutputEdit';
import {
  handleAnswerQuestions,
  handleAnswerQuestionsBefore,
  handleApprove,
  handleApproveDecision,
  handleRetry,
} from '../WorkflowHitlCoordinator';
import { handleUpstreamFix } from '../retry/UpstreamFix';

export interface WorkflowHitlFacadeDeps {
  hostRegistry: WorkflowEngineHostRegistry;
  instanceManager: WorkflowInstanceManager;
  diagnostics: WorkflowEngineDiagnostics;
}

export class WorkflowHitlFacadeImpl implements WorkflowEngineHitlFacade {
  constructor(private readonly deps: WorkflowHitlFacadeDeps) {}

  approve(stageId: string, panel: vscode.WebviewPanel): Promise<void> {
    return handleApprove(this.deps.hostRegistry.hitlHost(), stageId, panel);
  }

  approveDecision(
    stageId: string,
    decisionRecord: string,
    panel: vscode.WebviewPanel,
    instanceKey?: string,
  ): Promise<void> {
    return handleApproveDecision(
      this.deps.hostRegistry.hitlHost(),
      stageId,
      decisionRecord,
      panel,
      instanceKey,
    );
  }

  answerQuestions(
    stageId: string,
    answers: Record<string, string>,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    return handleAnswerQuestions(this.deps.hostRegistry.hitlHost(), stageId, answers, panel);
  }

  answerQuestionsBefore(
    stageId: string,
    answers: Record<string, string>,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    return handleAnswerQuestionsBefore(this.deps.hostRegistry.hitlHost(), stageId, answers, panel);
  }

  retry(stageId: string, comment: string, panel: vscode.WebviewPanel) {
    return handleRetry(this.deps.hostRegistry.hitlHost(), stageId, comment, panel);
  }

  upstreamFix(failedStageId: string, panel: vscode.WebviewPanel) {
    return handleUpstreamFix(this.deps.hostRegistry.hitlHost(), failedStageId, panel);
  }

  editOutput(stageId: string, outputKey: string, newContent: unknown): void {
    applyOutputEdit(this.deps.instanceManager, this.deps.diagnostics, stageId, outputKey, newContent);
  }
}
