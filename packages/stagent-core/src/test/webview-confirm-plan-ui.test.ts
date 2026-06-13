import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildConfirmStatsLines,
  collectArtifactPathsFromStages,
  countStagesByKind,
  getArtifactHeuristicWarnings,
  parsePhaseFromTitle,
  stripPhasePrefix,
} from '../WebviewConfirmPlanUi';

test('collectArtifactPathsFromStages gathers writeOutputToFile and file-write paths', () => {
  const paths = collectArtifactPathsFromStages([
    {
      id: 'a',
      title: 'config',
      tool: 'llm-text',
      toolConfig: { writeOutputToFile: './config.yaml' },
    },
    {
      id: 'b',
      title: 'reader',
      tool: 'llm-text',
      toolConfig: { writeOutputToFile: 'reader.py' },
    },
    {
      id: 'c',
      title: 'bundle',
      tool: 'file-write',
      toolConfig: { filePath: '.stagent/generated/x.md' },
    },
  ]);
  assert.deepEqual(paths, ['.stagent/generated/x.md', 'config.yaml', 'reader.py']);
});

test('getArtifactHeuristicWarnings flags config.yaml without config.py', () => {
  const paths = ['config.yaml', 'reader.py'];
  const stages = [
    { id: 'stage_test_run_x', title: 't', tool: 'code-runner' },
  ];
  const w = getArtifactHeuristicWarnings(paths, stages);
  assert.ok(w.some((line) => line.includes('config.py')));
});

test('parsePhaseFromTitle and stripPhasePrefix', () => {
  assert.equal(parsePhaseFromTitle('[Phase 2] 实现 reader'), 'Phase 2');
  assert.equal(stripPhasePrefix('[Phase 2] 实现 reader'), '实现 reader');
});

test('countStagesByKind and buildConfirmStatsLines', () => {
  const counts = countStagesByKind([
    { id: 'stage_decide_x', title: 'd', tool: 'llm-text', isDecisionStage: true, pauseAfter: true },
    { id: 'stage_impl_x', title: 'i', tool: 'llm-text' },
    { id: 'stage_test_run_x', title: 't', tool: 'code-runner' },
  ]);
  assert.equal(counts.decisionCount, 1);
  assert.equal(counts.implCount, 1);
  assert.equal(counts.testRunCount, 1);
  assert.equal(counts.pauseCount, 1);
  const lines = buildConfirmStatsLines({ taskType: 'prototype', ...counts });
  assert.ok(lines.some((l) => l.includes('prototype')));
  assert.ok(lines.some((l) => l.includes('3 个阶段')));
});
