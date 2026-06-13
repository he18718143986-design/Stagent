import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  formatWorkflowGeneratedWarningsForDisplay,
  formatWorkflowWarningForDisplay,
  parseWorkflowWarningLine,
} from '../Rule20WarningDisplay';

test('parseWorkflowWarningLine recognizes rule20 tokens', () => {
  assert.deepEqual(parseWorkflowWarningLine('rule20:missing-decision-stage:stage_impl_x'), {
    kind: 'rule20-violation',
    type: 'missing-decision-stage',
    stageId: 'stage_impl_x',
  });
  assert.deepEqual(parseWorkflowWarningLine('rule20-soft:model-tier-downgrade:workflow'), {
    kind: 'rule20-soft',
    type: 'model-tier-downgrade',
    stageId: 'workflow',
  });
  assert.deepEqual(parseWorkflowWarningLine('stage_count_near_limit'), {
    kind: 'builtin',
    type: 'stage_count_near_limit',
  });
});

test('formatWorkflowWarningForDisplay humanizes violations and soft warnings', () => {
  assert.match(
    formatWorkflowWarningForDisplay('rule20:missing-decision-stage:stage_impl_a'),
    /Rule20 违反/,
  );
  assert.match(
    formatWorkflowWarningForDisplay('rule20:missing-decision-stage:stage_impl_a'),
    /stage_impl_a/,
  );
  assert.match(formatWorkflowWarningForDisplay('rule20-soft:model-tier-downgrade:workflow'), /Rule20 提示/);
  assert.match(formatWorkflowWarningForDisplay('stage_count_near_limit'), /阶段数接近上限/);
});

test('formatWorkflowGeneratedWarningsForDisplay preserves order', () => {
  const lines = formatWorkflowGeneratedWarningsForDisplay([
    'stage_count_near_limit',
    'rule20:broken-naming-pair:stage_impl_x',
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /阶段数/);
  assert.match(lines[1], /命名不完整/);
});
