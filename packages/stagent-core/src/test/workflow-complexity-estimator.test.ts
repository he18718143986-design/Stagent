import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  complexityEstimateToWarningLines,
  estimateWorkflowComplexity,
} from '../WorkflowComplexityEstimator';

test('multi-module user input triggers global architecture decision', () => {
  const est = estimateWorkflowComplexity('做一个完整项目的多模块管理系统');
  assert.equal(est.requiresGlobalArchitectureDecision, true);
  assert.ok(est.estimatedStageCount >= 10);
});

test('exceeds hard cap for large module estimate', () => {
  const est = estimateWorkflowComplexity(
    '模块 '.repeat(30) + '完整项目全栈端到端',
  );
  assert.equal(est.exceedsHardCap, true);
  const warnings = complexityEstimateToWarningLines(est);
  assert.ok(warnings.some((w) => w.startsWith('complexity:exceeds-hard-cap')));
});
