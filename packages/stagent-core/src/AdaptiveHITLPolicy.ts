import { mustPauseForCharterProvenance } from './charter/CharterAnswerRouter';
import type { CharterAutoAnswerMode } from './charter/CharterTypes';
import type { Stage, StageRuntime } from './WorkflowDefinition';
import type { ConfidenceResult } from './ConfidenceScorer';
import { hitlMsg } from './l10n/hitlMsg';
import { HITL_CONFIDENCE_REASONS_MAX } from './UiListLimits';
import { DEFAULT_CONFIDENCE_PAUSE_THRESHOLD } from './StagentSettingsDefaults';
import {
  DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD,
  shouldEscalateContractNodePause,
} from './HITLContractNodePolicy';

export type HITLDecisionMode = 'inline-pause' | 'frontloaded';

export type HITLDecision =
  | { action: 'auto-advance' }
  | { action: 'pause'; reason: string; priority: 'low' | 'high' }
  | { action: 'pause-with-suggestion'; reason: string; suggestion: string };

export interface HITLPolicy {
  confidencePauseThreshold: number;
  alwaysPauseDecisionStages: boolean;
  maxAutoRetriesBeforePause: number;
  pauseOnNoHistoricalData: boolean;
  /** M21.4：契约节点（被 ≥2 下游引用 / 数据管道核心 impl）在置信度低于该阈值时升级暂停 */
  contractNodePauseThreshold: number;
  /** M21.4 总开关；false 退回纯 confidencePauseThreshold 行为 */
  pauseContractNodesBelowThreshold: boolean;
  /** B-R2：Charter 自动应答模式；影响 charter_inferred 是否强制暂停 */
  charterAutoAnswerMode: CharterAutoAnswerMode;
  /** B-R2：inline-pause=执行中逐决策暂停；frontloaded=确认页前置批准后放行 */
  decisionMode: HITLDecisionMode;
}

export const DEFAULT_HITL_POLICY: HITLPolicy = {
  confidencePauseThreshold: DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  alwaysPauseDecisionStages: true,
  maxAutoRetriesBeforePause: 2,
  pauseOnNoHistoricalData: false,
  contractNodePauseThreshold: DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD,
  pauseContractNodesBelowThreshold: true,
  charterAutoAnswerMode: 'off',
  decisionMode: 'inline-pause',
};

function isFrontloadApprovedDecision(runtime: StageRuntime, policy: HITLPolicy): boolean {
  return (
    policy.decisionMode === 'frontloaded' &&
    !!runtime.approvedDecisionRecord &&
    runtime.decisionSource === 'frontload'
  );
}

export function buildHITLPolicy(partial?: Partial<HITLPolicy>): HITLPolicy {
  return { ...DEFAULT_HITL_POLICY, ...partial };
}

/**
 * 纯函数：根据置信度与 stage 元数据决定 HITL 动作。
 * `stage.pauseAfter === true` 时恒 pause（向后兼容，§8.1）。
 */
export function evaluateHITL(
  stage: Stage,
  runtime: StageRuntime,
  confidence: ConfidenceResult,
  policy: HITLPolicy,
): HITLDecision {
  if (stage.pauseAfter === true) {
    return { action: 'pause', reason: 'stage.pauseAfter=true', priority: 'low' };
  }
  if (stage.isDecisionStage && policy.alwaysPauseDecisionStages) {
    if (isFrontloadApprovedDecision(runtime, policy)) {
      return { action: 'auto-advance' };
    }
    if (mustPauseForCharterProvenance(runtime.decisionProvenance, policy.charterAutoAnswerMode)) {
      return {
        action: 'pause',
        reason: hitlMsg('reason.charterProvenanceReview', runtime.decisionProvenance ?? 'unknown'),
        priority: 'high',
      };
    }
    if (
      policy.charterAutoAnswerMode === 'auto-with-escalation' &&
      runtime.decisionProvenance &&
      runtime.decisionProvenance !== 'human' &&
      runtime.decisionProvenance !== 'escalated'
    ) {
      return { action: 'auto-advance' };
    }
    return {
      action: 'pause',
      reason: hitlMsg('reason.decisionStageRequired'),
      priority: 'high',
    };
  }
  if (runtime.retryCount >= policy.maxAutoRetriesBeforePause) {
    return {
      action: 'pause',
      reason: hitlMsg(
        'reason.retryLimitReached',
        runtime.retryCount,
        policy.maxAutoRetriesBeforePause,
      ),
      priority: 'high',
    };
  }
  if (confidence.score < policy.confidencePauseThreshold) {
    const suggestion =
      confidence.reasons.length > 0
        ? hitlMsg(
            'suggestion.reviewWithReasons',
            confidence.reasons.slice(0, HITL_CONFIDENCE_REASONS_MAX).join('；'),
          )
        : hitlMsg('suggestion.reviewOutput');
    return {
      action: 'pause-with-suggestion',
      reason: hitlMsg(
        'reason.confidenceBelowThreshold',
        confidence.score,
        policy.confidencePauseThreshold,
      ),
      suggestion,
    };
  }
  return { action: 'auto-advance' };
}

/** M21.4：调用方（Executor）传入的契约节点上下文 */
export interface PauseStageContext {
  /** 本 stage 是否为契约节点（见 HITLContractNodePolicy.isContractNode） */
  isContractNode?: boolean;
}

/** 供 WorkflowExecutor 在 stage_end 前决定是否进入 paused。 */
export function shouldPauseAfterStage(
  stage: Stage,
  runtime: StageRuntime,
  confidence: ConfidenceResult | undefined,
  policy: HITLPolicy,
  ctx?: PauseStageContext,
): boolean {
  if (stage.pauseAfter === true) {
    return true;
  }
  if (stage.isDecisionStage && policy.alwaysPauseDecisionStages) {
    if (isFrontloadApprovedDecision(runtime, policy)) {
      return false;
    }
    if (mustPauseForCharterProvenance(runtime.decisionProvenance, policy.charterAutoAnswerMode)) {
      return true;
    }
    if (
      policy.charterAutoAnswerMode === 'auto-with-escalation' &&
      runtime.decisionProvenance &&
      runtime.decisionProvenance !== 'human' &&
      runtime.decisionProvenance !== 'escalated'
    ) {
      return false;
    }
    return true;
  }
  if (!confidence) {
    return stage.pauseAfter ?? false;
  }
  if (
    shouldEscalateContractNodePause({
      isContractNode: ctx?.isContractNode ?? false,
      confidenceScore: confidence.score,
      contractNodePauseThreshold: policy.contractNodePauseThreshold,
      enabled: policy.pauseContractNodesBelowThreshold,
    })
  ) {
    return true;
  }
  const decision = evaluateHITL(stage, runtime, confidence, policy);
  return decision.action !== 'auto-advance';
}
