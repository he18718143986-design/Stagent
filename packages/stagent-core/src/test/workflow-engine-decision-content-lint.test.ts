import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { evaluateDecisionContentLintGate } from '../DecisionRecordVerify';

/**
 * E 系列：M13.1 approveDecision 灰度门控合约测试。
 * 直接覆盖 evaluateDecisionContentLintGate（WorkflowEngine.approveDecision 中调用的纯函数）。
 * 与 WorkflowEngine 行为的对应关系：
 *   - outcome === 'pass'  → 引擎继续走 markDecisionApproved 推进路径
 *   - outcome === 'reject' → 引擎推 stageError(invariant-violation)，不推进、不清空 outputs
 */

const COMPLIANT_RECORD = `## 决策清单：模块 X

### 职责边界
- 负责：X 的核心职责

### 关键设计决策
- A：选 X 而非 Y — 理由：合适

### 边界压力测试
- 场景 1：边界 A 时，行为是 …
- 场景 2：边界 B 时，行为是 …

### AI 无法验证的假设
- 假设 1：若不成立 ...
`;

const MISSING_SECTION_RECORD = `## 决策清单：模块 X

### 职责边界
- 负责：X
`;

const SHORT_STRESS_RECORD = `## 决策清单：模块 X

### 职责边界
- 负责：X

### 关键设计决策
- A：合适

### 边界压力测试
- 场景 1：只有 1 个

### AI 无法验证的假设
- 假设 1：xxx
`;

const NO_ASSUMPTION_RECORD = `## 决策清单：模块 X

### 职责边界
- 负责：X

### 关键设计决策
- A：合适

### 边界压力测试
- 场景 1：xxx
- 场景 2：xxx

### AI 无法验证的假设

`;

const MULTI_VIOLATION_RECORD = `## 决策清单：模块 X

### 职责边界
- x

### 关键设计决策
- y

### 边界压力测试
- 场景 1：只 1 个

### AI 无法验证的假设

`;

// ────────────────────────────────────────────────────────────────

test('E1: gate closed (explicit false) + invalid record → pass', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: false },
    MISSING_SECTION_RECORD,
  );
  assert.equal(result.outcome, 'pass');
});

test('E1b: gate default (undefined) + invalid record → reject (M20.2.2)', () => {
  const result = evaluateDecisionContentLintGate(undefined, MISSING_SECTION_RECORD);
  assert.equal(result.outcome, 'reject');
  assert.match(result.rejectionSummary!, /I-17/);
});

test('E1c: vscode default off + invalid record → pass', () => {
  const result = evaluateDecisionContentLintGate(undefined, MISSING_SECTION_RECORD, {
    vscodeDefault: false,
  });
  assert.equal(result.outcome, 'pass');
});

test('E2: gate open + compliant record → pass', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    COMPLIANT_RECORD,
  );
  assert.equal(result.outcome, 'pass');
  assert.equal(result.rejectionSummary, undefined);
});

test('E3: gate open + missing section → reject with I-17', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    MISSING_SECTION_RECORD,
  );
  assert.equal(result.outcome, 'reject');
  assert.ok(result.rejectionSummary, '应有 rejectionSummary 文案');
  assert.match(result.rejectionSummary!, /I-17/);
  assert.ok(result.violationCodes && result.violationCodes.includes('missing-section'));
});

test('E4: gate open + stress test count = 1 → reject with I-18', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    SHORT_STRESS_RECORD,
  );
  assert.equal(result.outcome, 'reject');
  assert.match(result.rejectionSummary!, /I-18/);
  assert.ok(result.violationCodes && result.violationCodes.includes('insufficient-stress-tests'));
});

test('E5: gate open + assumptions = 0 → reject with I-19', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    NO_ASSUMPTION_RECORD,
  );
  assert.equal(result.outcome, 'reject');
  assert.match(result.rejectionSummary!, /I-19/);
  assert.ok(result.violationCodes && result.violationCodes.includes('insufficient-assumptions'));
});

test('E6: gate open + multi violations → reject 一次性聚合所有违反（用「；」分隔）', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    MULTI_VIOLATION_RECORD,
  );
  assert.equal(result.outcome, 'reject');
  // 同时违反 I-18 + I-19
  assert.match(result.rejectionSummary!, /I-18/);
  assert.match(result.rejectionSummary!, /I-19/);
  assert.ok(result.rejectionSummary!.includes('；'), 'reject 摘要应使用「；」分隔');
});

test('E7: gate open + 修复后再次校验 → pass（同一开关下幂等）', () => {
  // 第一次：不合规 → reject
  const firstAttempt = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    MISSING_SECTION_RECORD,
  );
  assert.equal(firstAttempt.outcome, 'reject');

  // 修复后再次：合规 → pass（模拟用户在审核器中补全后重新批准）
  const secondAttempt = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: true },
    COMPLIANT_RECORD,
  );
  assert.equal(secondAttempt.outcome, 'pass');
});

test('E8: gate 关闭时 globalConfig 其它字段不影响结果（与 DAG 调度独立）', () => {
  const result = evaluateDecisionContentLintGate(
    { enableDecisionContentLint: false },
    MISSING_SECTION_RECORD,
    { vscodeDefault: true },
  );
  assert.equal(result.outcome, 'pass');
});
