import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { scoreStatically } from '../OutputQualityScorer';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

const BASE_WF: WorkflowDefinition = {
  id: 'wf-test',
  version: '2.0',
  meta: {
    title: 't',
    taskType: 'software',
    userInput: 'u',
    createdAt: new Date().toISOString(),
  },
  stages: [],
};

function decisionStage(): Stage {
  return {
    id: 'stage_decide_foo',
    title: '架构决策',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(40) },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'decisionRecord', format: 'markdown' }],
    pauseAfter: true,
    isDecisionStage: true,
  };
}

function implStage(): Stage {
  return {
    id: 'stage_impl_foo',
    title: '实现',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(40) },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'implCode', format: 'markdown' }],
    pauseAfter: false,
  };
}

const COMPLIANT_DECISION = `## 决策清单：缓存

### 职责边界
- **负责**：内存缓存

### 关键设计决策
- **后端**：Map — 理由：简单

### 边界压力测试
- **场景 1**：高 QPS 时淘汰阻塞写入。
- **场景 2**：过期边界竞态导致永不过期。

### AI 无法验证的假设
- 假设 QPS < 1000：否则换 Redis。
`;

test('decision: compliant record → high decisionQuality and approve', () => {
  const score = scoreStatically(decisionStage(), COMPLIANT_DECISION, BASE_WF);
  assert.equal(score.dimensions.decisionQuality, 1);
  assert.ok(score.overall >= 0.75);
  assert.equal(score.recommendation, 'approve');
  assert.equal(score.issues.length, 0);
});

test('decision: missing sections → decision violations as issues', () => {
  const bad = COMPLIANT_DECISION.replace(/### 边界压力测试[\s\S]*?(?=### AI)/, '');
  const score = scoreStatically(decisionStage(), bad, BASE_WF);
  assert.ok(score.dimensions.decisionQuality < 0.8);
  assert.ok(score.issues.some((i) => i.code.startsWith('decision-missing-section')));
  assert.notEqual(score.recommendation, 'approve');
});

test('impl: hollow output → low codeValidity and retry/review', () => {
  const score = scoreStatically(implStage(), '好的，已确认，我将严格按照决策清单实现。', BASE_WF);
  assert.ok(score.dimensions.codeValidity <= 0.15);
  assert.ok(score.issues.some((i) => i.code === 'hollow-impl-output'));
  assert.notEqual(score.recommendation, 'approve');
});

test('impl: code fence → reasonable codeValidity', () => {
  const score = scoreStatically(
    implStage(),
    '```typescript\nexport function add(a: number, b: number) { return a + b; }\n```',
    BASE_WF,
  );
  assert.ok(score.dimensions.codeValidity >= 0.9);
});

test('truncated marker lowers completeness', () => {
  const score = scoreStatically(
    implStage(),
    '```ts\nconst x = 1;\n```\n\n[内容已截断，完整内容见 taskDir]',
    BASE_WF,
  );
  assert.ok(score.dimensions.completeness <= 0.4);
  assert.ok(score.issues.some((i) => i.code === 'truncated-output'));
});

test('empty output → zero completeness and retry', () => {
  const score = scoreStatically(implStage(), '   \n  ', BASE_WF);
  assert.equal(score.dimensions.completeness, 0);
  assert.equal(score.recommendation, 'retry');
});

test('test_write without systemPrompt does not throw on scoreStatically', () => {
  const stage: Stage = {
    id: 'stage_test_write_core',
    title: 'test write',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      writeOutputToFile: 'tests/test_core.py',
      writePathBase: 'workspace',
    } as Stage['toolConfig'],
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'testCode', format: 'text' }],
    pauseAfter: false,
  };
  const score = scoreStatically(stage, 'import pytest\n\ndef test_ok():\n    assert True\n', BASE_WF);
  assert.ok(score.overall > 0);
  assert.ok(score.issues.some((i) => i.code === 'thin-system-prompt'));
});
