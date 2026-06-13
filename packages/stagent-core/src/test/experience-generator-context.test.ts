import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildExperienceFewShotForGenerator } from '../ExperienceGeneratorContext';
import type { WorkflowExperience } from '../WorkflowExperienceStore';

test('buildExperienceFewShotForGenerator omits userInput and includes stage ids', () => {
  const block = buildExperienceFewShotForGenerator(
    [
      {
        id: '1',
        timestamp: 't',
        taskType: 'software',
        completionStatus: 'completed',
        stageCount: 5,
        humanInterventions: 1,
        stageOutcomes: [{ stageId: 'stage_impl_x', finalStatus: 'done' }],
      },
    ],
    { taskType: 'software' },
  );
  assert.ok(block.includes('stage_impl_x'));
  assert.ok(!block.includes('userInput'));
});

test('buildExperienceFewShotForGenerator includes test_run failure block', () => {
  const block = buildExperienceFewShotForGenerator(
    [
      {
        id: '1',
        timestamp: 't',
        taskType: 'prototype',
        completionStatus: 'failed',
        failureStageId: 'stage_test_run_prototype_fetcher_check',
        failureErrorType: 'tool-execution-failed',
      },
    ],
    { taskType: 'prototype' },
  );
  assert.ok(block.includes('test_run 失败'));
  assert.ok(block.includes('config.yaml'));
});
