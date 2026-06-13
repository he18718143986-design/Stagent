import { LOG_PREVIEW_SHORT } from './LogPreviewLimits';
import type { WorkflowDefinition } from './WorkflowDefinition';
import { buildLlmWaitingDetail } from './WebviewInputGenerationUi';
import { HOST_INPUT_PAGE_BUSY_TITLES as INPUT_PAGE_BUSY_TITLES } from './WebviewInputGenerationUiHost';
import { isAutoTaskType } from './TaskTypeResolution';
import type { GenerationContext } from './WorkflowGenerationContext';
import { TRACE_STAGE_WORKFLOW_GEN } from './generation/GenerationTraceStageIds';
import {
  MAX_WORKFLOW_GEN_ATTEMPTS,
  type GenerationRunnerHost,
  type RunWorkflowGenerationParams,
} from './WorkflowGenerationRunner';
import { DEBUG_EVENT_PARSE_FAILED_RETRY } from './DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import { GENERATION_OPERATION_WORKFLOW } from './generation/GenerationOperationIds';
import { assessGeneratedPlanStructure } from './generation/assessGeneratedPlanStructure';
import { workflowGenLlmInvokeOpts } from './core/LlmInvokeOpts';
import { getStagentConfiguration } from './settings/getStagentConfiguration';
import { resolveWorkflowGenMaxOutputTokens } from './generation/workflowGenMaxTokens';

// Token budget management
const DEFAULT_TOKEN_BUDGET = 40000; // Default token limit per generation
const TOKEN_BUDGET_WARNING_THRESHOLD = 0.8; // Warn when 80% consumed
const ESTIMATE_TOKENS_PER_CHAR = 0.25; // Rough estimate: 1 token ≈ 4 characters

function estimateTokens(text: string): number {
  return Math.ceil(text.length * ESTIMATE_TOKENS_PER_CHAR);
}

export async function runLlmParseRetryLoop(
  host: GenerationRunnerHost,
  ctx: GenerationContext,
  params: RunWorkflowGenerationParams,
): Promise<WorkflowDefinition> {
  const { taskType, panel } = params;
  const { systemPrompt, userPayload } = ctx;
  const maxAttempts = params.maxParseAttempts ?? MAX_WORKFLOW_GEN_ATTEMPTS;
  
  // Initialize token budget tracking
  // Use readCodebaseContextMaxTokens as a reference for total generation budget
  const maxTokenBudget = Math.max(params.readCodebaseContextMaxTokens * 2, DEFAULT_TOKEN_BUDGET);
  let tokensBurned = 0;
  let parseAttempts = 0;

  host.postGenerationProgress(
    panel,
    GENERATION_OPERATION_WORKFLOW,
    'llm',
    INPUT_PAGE_BUSY_TITLES.workflowLlm,
    buildLlmWaitingDetail(isAutoTaskType(taskType)),
  );

  let wf: WorkflowDefinition | undefined;
  let lastParseError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check token budget before proceeding
    if (tokensBurned > maxTokenBudget * TOKEN_BUDGET_WARNING_THRESHOLD) {
      const budgetExhaustedMsg = `解析失败重试已接近 token 预算上限（已使用 ${tokensBurned}/${maxTokenBudget}）。降级为手动修复。`;
      host.postGenerationProgress(
        panel,
        GENERATION_OPERATION_WORKFLOW,
        'parsing',
        '警告',
        budgetExhaustedMsg,
      );
      host.debugLog(WORKFLOW_LEVEL_STAGE_ID, 'token_budget_exhausted', 0, {
        tokensBurned,
        maxBudget: maxTokenBudget,
        attempts: attempt,
      });
      
      // Escalate to HITL instead of continuing to retry
      throw new Error(
        `工作流生成失败：${parseAttempts > 2 ? '重试次数过多' : 'Token 预算不足'}，建议使用 HITL 手动修复。`
      );
    }

    if (attempt > 1) {
      host.postGenerationProgress(
        panel,
        GENERATION_OPERATION_WORKFLOW,
        'llm',
        INPUT_PAGE_BUSY_TITLES.workflowLlm,
        `上次输出无法解析为 JSON，正在自动重试（第 ${attempt}/${maxAttempts} 次）…`,
      );
    }

    const genMaxTokens = resolveWorkflowGenMaxOutputTokens(
      getStagentConfiguration(),
      ctx.pathRouter.workflowTemplate,
    );
    const raw = await host.invokeLlmRaw(
      systemPrompt,
      userPayload,
      panel,
      TRACE_STAGE_WORKFLOW_GEN,
      workflowGenLlmInvokeOpts(genMaxTokens),
    );
    tokensBurned += estimateTokens(raw);
    parseAttempts++;

    if (!raw.trim()) {
      lastParseError = new Error('workflow-gen 模型返回空响应');
      host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PARSE_FAILED_RETRY, 0, {
        attempt,
        maxAttempts,
        error: 'empty_llm_response',
        tokensBurned,
        maxBudget: maxTokenBudget,
      });
      continue;
    }

    host.postGenerationProgress(
      panel,
      GENERATION_OPERATION_WORKFLOW,
      'parsing',
      '正在解析模型输出',
      `提取 JSON 并必要时请求修复…（Token 用量: ${tokensBurned}/${maxTokenBudget}）`,
    );
    
    try {
      // 续接/修复的 LLM 输出也计入 token 预算（此前只算主输出，截断续接成本被低估）。
      wf = await host.parseWorkflowJson(raw, panel, (aux) => {
        tokensBurned += estimateTokens(aux);
      }, genMaxTokens);
      if (!(wf.stages?.length ?? 0)) {
        lastParseError = new Error('workflow-gen JSON 解析成功但 stages 为空');
        host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PARSE_FAILED_RETRY, 0, {
          attempt,
          maxAttempts,
          error: 'empty_stages_after_parse',
          tokensBurned,
          maxBudget: maxTokenBudget,
        });
        continue;
      }
      const structural = assessGeneratedPlanStructure(wf, taskType);
      if (structural) {
        lastParseError = new Error(`workflow-gen 计划结构不完整：${structural.reason}`);
        host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PARSE_FAILED_RETRY, 0, {
          attempt,
          maxAttempts,
          error: structural.issue,
          detail: structural.reason.slice(0, LOG_PREVIEW_SHORT),
          stageCount: wf.stages?.length ?? 0,
          tokensBurned,
          maxBudget: maxTokenBudget,
        });
        continue;
      }
      host.debugLog(WORKFLOW_LEVEL_STAGE_ID, 'parse_success', 0, {
        attempt,
        totalTokensBurned: tokensBurned,
        maxBudget: maxTokenBudget,
      });
      break;
    } catch (parseErr) {
      lastParseError = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_PARSE_FAILED_RETRY, 0, {
        attempt,
        maxAttempts,
        error: lastParseError.message.slice(0, LOG_PREVIEW_SHORT),
        tokensBurned,
        maxBudget: maxTokenBudget,
      });
    }
  }
  
  if (!wf || !(wf.stages?.length ?? 0)) {
    const finalMsg =
      tokensBurned > maxTokenBudget * TOKEN_BUDGET_WARNING_THRESHOLD
        ? `工作流生成失败：Token 预算已使用 ${tokensBurned}/${maxTokenBudget}，无法继续重试。`
        : `工作流生成失败：模型输出无法解析为 JSON（尝试 ${parseAttempts} 次）。`;
    throw lastParseError ?? new Error(finalMsg);
  }

  return wf;
}
