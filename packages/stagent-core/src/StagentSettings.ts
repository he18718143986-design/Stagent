import type { ConfigPort } from './platform/PlatformAdapter';
import { resolveLlmMaxOutputTokens, resolveLlmTimeoutSeconds } from './LlmInvokeHelpers';
import { DEFAULT_MAX_MANUAL_STAGE_RETRIES, normalizeMaxManualStageRetries } from './ManualRetryLimit';
import type { GlobalDecisionInjectMode } from './WorkflowDefinition';
import {
  DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES,
  DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
  DEFAULT_DAG_MAX_PARALLELISM,
  DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD,
  resolveConfidencePauseThreshold,
  resolveMemoryMaxExperienceEntries,
  resolveCodebaseContextMaxTokens,
  resolveDagMaxParallelism,
  resolveContractNodePauseThreshold,
} from './StagentSettingsDefaults';
import { DEFAULT_RED_GREEN_MODE, resolveRedGreenMode, type RedGreenMode } from './RedGreenGate';
import { AGENT_ROLES, type AgentRole } from './AgentSpecializationRouter';

export {
  DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES,
  DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
  DEFAULT_DAG_MAX_PARALLELISM,
  resolveConfidencePauseThreshold,
  resolveMemoryMaxExperienceEntries,
  resolveCodebaseContextMaxTokens,
  resolveDagMaxParallelism,
} from './StagentSettingsDefaults';

/** vscode `stagent.confidence.pauseThreshold`；M16.2 AdaptiveHITL 将消费，M15.7 仅引擎读取并写 debug 日志 */
export function readConfidencePauseThreshold(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveConfidencePauseThreshold(c.get('confidence.pauseThreshold'));
  } catch {
    return DEFAULT_CONFIDENCE_PAUSE_THRESHOLD;
  }
}

/** `stagent.hitl.contractNodePauseThreshold`；M21.4，默认 0.75 */
export function readContractNodePauseThreshold(cfg: ConfigPort): number {
  try {
    return resolveContractNodePauseThreshold(cfg.get('hitl.contractNodePauseThreshold'));
  } catch {
    return DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD;
  }
}

/** `stagent.hitl.pauseContractNodes`；M21.4，默认 true（false 回滚至纯 confidence 阈值） */
export function readPauseContractNodesEnabled(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('hitl.pauseContractNodes') !== false;
  } catch {
    return true;
  }
}

/** `stagent.plan.requireCompleteness`；M27.1/M27.2（P0）计划完整性硬门，默认 true */
export function readPlanCompletenessGateEnabled(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('plan.requireCompleteness') !== false;
  } catch {
    return true;
  }
}

/** `stagent.tdd.redGreenGate`；M22.1，默认 'warn'（off=关闭/warn=仅告警/hard=GREEN-before-impl 阻断） */
export function readRedGreenGateMode(cfg: ConfigPort): RedGreenMode {
  try {
    return resolveRedGreenMode(cfg.get('tdd.redGreenGate'));
  } catch {
    return DEFAULT_RED_GREEN_MODE;
  }
}

/** `stagent.debug.requireFeedbackLoop`；M22.3（I-26），默认 true */
export function readDebugRequireFeedbackLoop(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('debug.requireFeedbackLoop') !== false;
  } catch {
    return true;
  }
}

/** `stagent.grill.adaptiveMode`；M23，默认 false（开启自适应「一次一问」grill） */
export function readGrillAdaptiveModeEnabled(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('grill.adaptiveMode') === true;
  } catch {
    return false;
  }
}

/** `stagent.glossary.enabled`；M24，默认 true（活 CONTEXT.md 词汇表 + ADR 留存） */
export function readGlossaryEnabled(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('glossary.enabled') !== false;
  } catch {
    return true;
  }
}

/** `stagent.architecture.depthScoring`；M25，默认 false（深模块评分接入质量分） */
export function readArchitectureDepthScoringEnabled(cfg: ConfigPort): boolean {
  try {
    return cfg.get<boolean>('architecture.depthScoring') === true;
  } catch {
    return false;
  }
}

/** vscode `stagent.memory.enableExperienceStore`；默认 true */
export function readMemoryExperienceStoreEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('memory.enableExperienceStore') !== false;
  } catch {
    return true;
  }
}

/** vscode `stagent.memory.maxExperienceEntries` */
export function readMemoryMaxExperienceEntries(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveMemoryMaxExperienceEntries(c.get('memory.maxExperienceEntries'));
  } catch {
    return DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES;
  }
}

/** vscode `stagent.codebaseContext.enabled`；默认 true */
export function readCodebaseContextEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('codebaseContext.enabled') !== false;
  } catch {
    return true;
  }
}

/** vscode `stagent.codebaseContext.maxTokens` */
export function readCodebaseContextMaxTokens(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveCodebaseContextMaxTokens(c.get('codebaseContext.maxTokens'));
  } catch {
    return DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS;
  }
}

/** vscode `stagent.dagMaxParallelism` */
export function readDagMaxParallelism(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveDagMaxParallelism(c.get('dagMaxParallelism'));
  } catch {
    return DEFAULT_DAG_MAX_PARALLELISM;
  }
}

/** vscode `stagent.sandbox.enabled`；默认 false */
export function readSandboxEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('sandbox.enabled') === true;
  } catch {
    return false;
  }
}

/** M17.6 灰度：generateWorkflow 注入经验 few-shot；默认 false */
export function readExperienceInjectOnGenerate(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('experience.injectOnGenerate') === true;
  } catch {
    return false;
  }
}

/** M18.1：`generateWorkflow` 从 PromptVersionManager 读取槽位；默认 true */
export function readPromptVersionsEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('promptVersions.enabled') !== false;
  } catch {
    return true;
  }
}

/** M18.2：静态分析管道接入热路径；默认 false（灰度） */
export function readStaticAnalysisEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('staticAnalysis.enabled') === true;
  } catch {
    return false;
  }
}

/** vscode `stagent.llmTimeoutSeconds` → 毫秒 */
export function readLlmTimeoutMs(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveLlmTimeoutSeconds(c.get('llmTimeoutSeconds')) * 1000;
  } catch {
    return resolveLlmTimeoutSeconds(undefined) * 1000;
  }
}

/** vscode `stagent.llmMaxOutputTokens` → Direct API 请求体 max_tokens */
export function readLlmMaxOutputTokens(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return resolveLlmMaxOutputTokens(c.get('llmMaxOutputTokens'));
  } catch {
    return resolveLlmMaxOutputTokens(undefined);
  }
}

/**
 * vscode `stagent.llmModelByRole`；按 Agent 角色覆盖模型 family
 * （如 `{ "test-write": "direct:glm-4" }`，让写测试与写实现用异族模型）。
 * 默认 `{}` = 全部角色沿用全局 preferredModelFamily（行为与历史一致）。
 */
export function readPreferredModelByRole(cfg: ConfigPort): Partial<Record<AgentRole, string>> {
  try {
    const raw = cfg.get<Record<string, unknown>>('llmModelByRole');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    const out: Partial<Record<AgentRole, string>> = {};
    for (const role of AGENT_ROLES) {
      const v = (raw as Record<string, unknown>)[role];
      if (typeof v === 'string' && v.trim()) {
        out[role] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** vscode `stagent.debugVerbose`；默认 false */
export function readDebugVerbose(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('debugVerbose') === true;
  } catch {
    return false;
  }
}

/** vscode `stagent.enableRuntimeRule20Verify`；默认 true（显式 false 回滚 v2.7） */
export function readRuntimeRule20VerifyEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('enableRuntimeRule20Verify') !== false;
  } catch {
    return true;
  }
}

/** vscode `stagent.enableDecisionContentLint`；默认 true（workflow globalConfig 可覆盖） */
export function readDecisionContentLintEnabled(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('enableDecisionContentLint') !== false;
  } catch {
    return true;
  }
}

/** vscode `stagent.maxManualStageRetries`；默认 3 / minimum 1 */
export function readMaxManualStageRetries(cfg: ConfigPort): number {
  try {
    const c = cfg;
    return normalizeMaxManualStageRetries(c.get<number>('maxManualStageRetries'));
  } catch {
    return DEFAULT_MAX_MANUAL_STAGE_RETRIES;
  }
}

/** vscode `stagent.injectApprovedDecisionContext`；默认 true */
export function readInjectApprovedDecisionContext(cfg: ConfigPort): boolean {
  try {
    const c = cfg;
    return c.get<boolean>('injectApprovedDecisionContext') !== false;
  } catch {
    return true;
  }
}

/** vscode `stagent.globalDecisionInjectMode`；默认 summary */
export function readGlobalDecisionInjectMode(
  cfg: ConfigPort,
): GlobalDecisionInjectMode {
  try {
    const c = cfg;
    return c.get<string>('globalDecisionInjectMode') === 'full' ? 'full' : 'summary';
  } catch {
    return 'summary';
  }
}
