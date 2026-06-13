import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildConfidenceSignals,
  classifyStageType,
  computeConfidence,
  type ConfidenceSignals,
} from '../ConfidenceScorer';
import { scoreStatically, type QualityScore } from '../OutputQualityScorer';
import type { Stage, StageRuntime, WorkflowDefinition } from '../WorkflowDefinition';

function goodQuality(): QualityScore {
  return {
    overall: 0.92,
    dimensions: {
      completeness: 1,
      codeValidity: 0.95,
      specCompliance: 1,
      decisionQuality: 1,
    },
    issues: [],
    recommendation: 'approve',
  };
}

function poorQuality(): QualityScore {
  return {
    overall: 0.28,
    dimensions: {
      completeness: 0,
      codeValidity: 0.1,
      specCompliance: 0.5,
      decisionQuality: 0.3,
    },
    issues: [{ code: 'hollow-impl-output', severity: 'error', message: '空洞' }],
    recommendation: 'retry',
  };
}

function implStage(): Stage {
  return {
    id: 'stage_impl_svc',
    title: 'impl',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(40) },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'implCode', format: 'markdown' }],
    pauseAfter: false,
  };
}

function runtime(retryCount = 0): StageRuntime {
  return {
    stageId: 'stage_impl_svc',
    status: 'running',
    outputs: {},
    retryCount,
  };
}

test('classifyStageType maps decision / impl / test / other', () => {
  assert.equal(
    classifyStageType({ ...implStage(), isDecisionStage: true, id: 'stage_decide_x' }),
    'decision',
  );
  assert.equal(classifyStageType(implStage()), 'impl');
  assert.equal(
    classifyStageType({ ...implStage(), id: 'stage_test_run_unit' }),
    'test',
  );
  assert.equal(classifyStageType({ ...implStage(), id: 'stage_zoom_out' }), 'other');
});

test('high quality + no retries → high confidence', () => {
  const code = '```typescript\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```';
  const signals = buildConfidenceSignals(implStage(), runtime(), 'implCode', code, goodQuality());
  const result = computeConfidence(signals);
  assert.equal(result.level, 'high');
  assert.ok(result.score >= 0.75);
});

test('poor quality → low or critical', () => {
  const signals: ConfidenceSignals = {
    qualityScore: poorQuality(),
    retryCount: 0,
    stageType: 'impl',
    outputLength: 30,
    hasCodeBlock: false,
    matchesExpectedOutputKey: true,
  };
  const result = computeConfidence(signals);
  assert.ok(result.score < 0.55);
  assert.ok(['low', 'critical'].includes(result.level));
  assert.ok(result.reasons.some((r) => r.includes('重试') || r.includes('错误')));
});

test('retryCount increases penalty', () => {
  const base = buildConfidenceSignals(
    implStage(),
    runtime(0),
    'implCode',
    '```ts\nconst a=1;\n```',
    goodQuality(),
  );
  const retried = buildConfidenceSignals(
    implStage(),
    runtime(3),
    'implCode',
    '```ts\nconst a=1;\n```',
    goodQuality(),
  );
  assert.ok(computeConfidence(retried).score < computeConfidence(base).score);
  assert.ok(computeConfidence(retried).reasons.some((r) => r.includes('重试 3')));
});

test('output key mismatch lowers confidence', () => {
  const signals = buildConfidenceSignals(
    implStage(),
    runtime(),
    'wrongKey',
    '```ts\nx\n```',
    goodQuality(),
  );
  const result = computeConfidence(signals);
  assert.ok(result.reasons.some((r) => r.includes('输出键')));
});

test('priorFailurePattern stub applies penalty', () => {
  const signals: ConfidenceSignals = {
    qualityScore: goodQuality(),
    retryCount: 0,
    stageType: 'impl',
    outputLength: 200,
    hasCodeBlock: true,
    matchesExpectedOutputKey: true,
    priorFailurePattern: 'hollow-impl',
  };
  const without = computeConfidence({ ...signals, priorFailurePattern: undefined });
  const withPattern = computeConfidence(signals);
  assert.ok(withPattern.score < without.score);
  assert.ok(withPattern.reasons.some((r) => r.includes('历史失败模式')));
});

test('non-code artifact (requirements.txt) not penalized → high confidence, no false pause', () => {
  const reqStage: Stage = {
    id: 'stage_impl_requirements',
    title: 'requirements',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'x'.repeat(40),
      writeOutputToFile: 'requirements.txt',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'requirements', format: 'markdown' }],
    pauseAfter: false,
  };
  const content = 'pandas\nnumpy\nopenpyxl\nrequests';
  const quality = scoreStatically(reqStage, content, {} as WorkflowDefinition);
  const signals = buildConfidenceSignals(
    reqStage,
    { stageId: reqStage.id, status: 'running', outputs: {}, retryCount: 0 },
    'requirements',
    content,
    quality,
  );
  assert.equal(signals.isNonCodeArtifact, true);
  const result = computeConfidence(signals);
  assert.notEqual(result.level, 'critical');
  assert.ok(result.score >= 0.75, `score=${result.score}`);
  assert.ok(!result.reasons.some((r) => r.includes('代码块')));
});

test('missing qualityScore uses neutral prior', () => {
  const signals: ConfidenceSignals = {
    retryCount: 0,
    stageType: 'other',
    outputLength: 500,
    hasCodeBlock: false,
    matchesExpectedOutputKey: true,
  };
  const result = computeConfidence(signals);
  assert.ok(result.reasons.some((r) => r.includes('中性先验')));
  assert.ok(result.score >= 0.55);
});
