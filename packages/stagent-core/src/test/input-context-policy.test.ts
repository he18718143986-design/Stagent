import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  classifyStageOutputSource,
  DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT,
  INPUT_THRESHOLDS_DECISION_RECORD,
  INPUT_THRESHOLDS_DEFAULT,
  planInputDegradeMode,
  pickEntryIndexToDegrade,
  allocateContextBudget,
  classifyInputSourceBudgetCategory,
  truncateTextToTokenBudget,
  resolveExplicitContextDegradeMode,
  thresholdsForRole,
} from '../InputContextPolicy';

test('classifyStageOutputSource tiers decisionRecord vs implementation vs default', () => {
  assert.equal(
    classifyStageOutputSource({ type: 'stage-output', stageId: 'a', outputKey: 'decisionRecord' }),
    'decision-record',
  );
  assert.equal(
    classifyStageOutputSource({ type: 'stage-output', stageId: 'a', outputKey: 'testCode' }),
    'implementation',
  );
  assert.equal(
    classifyStageOutputSource({ type: 'stage-output', stageId: 'stage_impl_prototype_reader', outputKey: 'text' }),
    'implementation',
  );
  assert.equal(
    classifyStageOutputSource({ type: 'stage-output', stageId: 'a', outputKey: 'npmInitLog' }),
    'default',
  );
});

test('planInputDegradeMode keeps decisionRecord full longer than default output', () => {
  const mediumTokens = 2000;
  assert.equal(planInputDegradeMode(mediumTokens, 'decision-record'), 'full');
  assert.equal(planInputDegradeMode(mediumTokens, 'default'), 'summary');
  assert.equal(planInputDegradeMode(INPUT_THRESHOLDS_DEFAULT.fullMax, 'default'), 'full');
  assert.equal(planInputDegradeMode(INPUT_THRESHOLDS_DECISION_RECORD.fullMax, 'decision-record'), 'full');
  assert.equal(
    planInputDegradeMode(INPUT_THRESHOLDS_DECISION_RECORD.fullMax + 1, 'decision-record'),
    'summary',
  );
});

test('pickEntryIndexToDegrade prefers non-preserved entries', () => {
  const idx = pickEntryIndexToDegrade([
    { mode: 'full', preservePriority: true, tokenCount: 9000 },
    { mode: 'full', preservePriority: false, tokenCount: 2000 },
    { mode: 'full', preservePriority: false, tokenCount: 5000 },
  ]);
  assert.equal(idx, 2);
});

test('pickEntryIndexToDegrade skips already-reference entries', () => {
  const idx = pickEntryIndexToDegrade([
    { mode: 'reference', preservePriority: false, tokenCount: 9000 },
    { mode: 'full', preservePriority: true, tokenCount: 100 },
  ]);
  assert.equal(idx, 1);
});

test('allocateContextBudget prioritizes decisionRecord over codebase snapshot', () => {
  const sources = [
    { type: 'stage-output' as const, stageId: 'stage_decide_a', outputKey: 'decisionRecord' },
  ];
  const { budget, allocations } = allocateContextBudget(sources, 6_000, {
    reservedForOutput: 0,
    includeCodebaseSnapshot: true,
    codebaseSnapshotTokens: 10_000,
    sourceTokenCounts: [10_000],
  });
  assert.ok(budget.decisionContextMax > budget.codebaseContextMax);
  const decision = allocations.find((a) => a.category === 'decision-record');
  const snapshot = allocations.find((a) => a.category === 'codebase-snapshot');
  assert.ok(decision && snapshot);
  assert.ok(decision.grantedTokens > snapshot.grantedTokens);
});

test('allocateContextBudget reduces codebase before decision when over availableForInput', () => {
  const sources = [
    { type: 'stage-output' as const, stageId: 'd', outputKey: 'decisionRecord' },
    { type: 'stage-output' as const, stageId: 'i1', outputKey: 'code' },
    { type: 'stage-output' as const, stageId: 'i2', outputKey: 'code' },
    { type: 'stage-output' as const, stageId: 'i3', outputKey: 'code' },
  ];
  const { budget, allocations } = allocateContextBudget(sources, 3_000, {
    reservedForOutput: 0,
    includeCodebaseSnapshot: true,
    codebaseSnapshotTokens: 5_000,
    sourceTokenCounts: [5_000, 4_000, 4_000, 4_000],
  });
  const totalGranted = allocations.reduce((s, a) => s + a.grantedTokens, 0);
  assert.ok(totalGranted <= budget.availableForInput);
  const decision = allocations.find((a) => a.category === 'decision-record')!;
  const snapshot = allocations.find((a) => a.category === 'codebase-snapshot')!;
  assert.ok(decision.grantedTokens >= snapshot.grantedTokens);
});

test('classifyInputSourceBudgetCategory maps global decision label', () => {
  assert.equal(
    classifyInputSourceBudgetCategory({
      type: 'stage-output',
      stageId: 'x',
      outputKey: 'injected',
      label: '_stagent_approved_decisions',
    }),
    'global-decision',
  );
});

test('truncateTextToTokenBudget caps long text', () => {
  const long = 'x'.repeat(10_000);
  const out = truncateTextToTokenBudget(long, 100);
  assert.ok(out.length < long.length);
  assert.match(out, /内容已截断/);
});

test('DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT matches engine resolveInput ceiling', () => {
  assert.equal(DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT, 60_000);
});

test('resolveExplicitContextDegradeMode honors contextMode full on large impl output', () => {
  const source = {
    type: 'stage-output' as const,
    stageId: 'stage_impl_x',
    outputKey: 'fileContent',
    contextMode: 'full' as const,
  };
  const role = classifyStageOutputSource(source);
  assert.equal(resolveExplicitContextDegradeMode(source, 50_000, role), 'full');
});

test('implementation role preserves on total overflow', () => {
  assert.equal(thresholdsForRole('implementation').preserveOnTotalOverflow, true);
});
