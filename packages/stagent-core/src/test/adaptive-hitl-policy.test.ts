import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DEFAULT_HITL_POLICY,
  evaluateHITL,
  shouldPauseAfterStage,
} from '../AdaptiveHITLPolicy';
import type { Stage, StageRuntime } from '../WorkflowDefinition';
import type { ConfidenceResult } from '../ConfidenceScorer';

function stage(partial: Partial<Stage> & Pick<Stage, 'id'>): Stage {
  return {
    title: partial.id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...partial,
  };
}

function runtime(retryCount = 0): StageRuntime {
  return { stageId: 's', status: 'running', outputs: {}, retryCount };
}

function confidence(score: number): ConfidenceResult {
  return { score, level: score >= 0.75 ? 'high' : 'low', reasons: ['test'] };
}

test('decision stage always pauses even with high confidence', () => {
  const st = stage({ id: 'stage_decide_x', isDecisionStage: true, pauseAfter: false });
  const decision = evaluateHITL(st, runtime(), confidence(0.95), DEFAULT_HITL_POLICY);
  assert.notEqual(decision.action, 'auto-advance');
});

test('explicit pauseAfter=true bypasses auto-advance', () => {
  const st = stage({ id: 'stage_impl_x', pauseAfter: true });
  const decision = evaluateHITL(st, runtime(), confidence(0.99), DEFAULT_HITL_POLICY);
  assert.equal(decision.action, 'pause');
});

test('low confidence impl stage pauses when pauseAfter=false', () => {
  const st = stage({ id: 'stage_impl_x', pauseAfter: false });
  assert.equal(
    shouldPauseAfterStage(st, runtime(), confidence(0.2), DEFAULT_HITL_POLICY),
    true,
  );
});

test('high confidence impl stage auto-advances when pauseAfter=false', () => {
  const st = stage({ id: 'stage_impl_x', pauseAfter: false });
  assert.equal(
    shouldPauseAfterStage(st, runtime(), confidence(0.9), DEFAULT_HITL_POLICY),
    false,
  );
});

test('retry count at policy limit forces pause', () => {
  const st = stage({ id: 'stage_impl_x', pauseAfter: false });
  const rt = runtime(2);
  const decision = evaluateHITL(st, rt, confidence(0.9), DEFAULT_HITL_POLICY);
  assert.equal(decision.action, 'pause');
});

test('charter_inferred pauses in suggest mode on decision stage', () => {
  const st = stage({ id: 'stage_decide_x', isDecisionStage: true });
  const rt: StageRuntime = {
    ...runtime(),
    stageId: st.id,
    decisionProvenance: 'charter_inferred',
  };
  const policy = { ...DEFAULT_HITL_POLICY, charterAutoAnswerMode: 'suggest' as const };
  const conf = confidence(0.9);
  assert.equal(evaluateHITL(st, rt, conf, policy).action, 'pause');
  assert.equal(shouldPauseAfterStage(st, rt, conf, policy), true);
});

test('charter_direct auto-advances in auto-with-escalation on decision stage', () => {
  const st = stage({ id: 'stage_decide_x', isDecisionStage: true });
  const rt: StageRuntime = {
    ...runtime(),
    stageId: st.id,
    decisionProvenance: 'charter_direct',
  };
  const policy = { ...DEFAULT_HITL_POLICY, charterAutoAnswerMode: 'auto-with-escalation' as const };
  assert.equal(shouldPauseAfterStage(st, rt, confidence(0.9), policy), false);
});

test('escalated provenance still pauses in auto-with-escalation', () => {
  const st = stage({ id: 'stage_decide_x', isDecisionStage: true });
  const rt: StageRuntime = {
    ...runtime(),
    stageId: st.id,
    decisionProvenance: 'escalated',
  };
  const policy = { ...DEFAULT_HITL_POLICY, charterAutoAnswerMode: 'auto-with-escalation' as const };
  assert.equal(shouldPauseAfterStage(st, rt, confidence(0.9), policy), true);
});
