import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { analyzeFailurePatterns } from '../FailurePatternAnalyzer';
import type { WorkflowExperience } from '../WorkflowExperienceStore';

const FIXTURE: WorkflowExperience[] = [
  {
    id: '1',
    timestamp: '2026-01-01',
    taskType: 'software',
    completionStatus: 'failed',
    failureStageId: 'stage_impl_x',
    failureErrorType: 'tool-execution-failed',
    humanInterventions: 2,
    stageOutcomes: [{ stageId: 'stage_impl_x', confidenceScore: 0.2 }],
  },
  {
    id: '2',
    timestamp: '2026-01-02',
    taskType: 'software',
    completionStatus: 'failed',
    failureStageId: 'stage_test_run_x',
    failureErrorType: 'code-runner-timeout',
  },
  {
    id: '3',
    timestamp: '2026-01-03',
    taskType: 'software',
    completionStatus: 'failed',
    failureStageId: 'stage_decide_x',
    failureErrorType: 'invariant-violation',
    humanInterventions: 6,
  },
  {
    id: '4',
    timestamp: '2026-01-04',
    taskType: 'software',
    completionStatus: 'completed',
    humanInterventions: 1,
    stageOutcomes: [{ stageId: 'stage_impl_ok', confidenceScore: 0.2 }],
  },
  {
    id: '5',
    timestamp: '2026-01-05',
    taskType: 'software',
    completionStatus: 'abandoned',
    humanInterventions: 7,
  },
];

test('analyzeFailurePatterns yields at least 3 actionable kinds', () => {
  const report = analyzeFailurePatterns(FIXTURE);
  const kinds = new Set(report.patterns.map((p) => p.kind));
  assert.ok(kinds.size >= 3, `expected >=3 kinds, got ${[...kinds].join(',')}`);
});

test('analyzeFailurePatterns classifies test_run tool-execution-failed as import artifact pattern', () => {
  const report = analyzeFailurePatterns([
    {
      id: 'p1',
      timestamp: 't',
      taskType: 'prototype',
      completionStatus: 'failed',
      failureStageId: 'stage_test_run_prototype_fetcher_check',
      failureErrorType: 'tool-execution-failed',
    },
  ]);
  assert.ok(report.patterns.some((p) => p.kind === 'test-run-import-missing-artifact'));
});
