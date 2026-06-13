import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { WorkflowParallelMonitor } from '../WorkflowParallelMonitor';

test('WorkflowParallelMonitor records wave lifecycle', () => {
  const mon = new WorkflowParallelMonitor();
  const idx = mon.recordWaveStart(['a', 'b']);
  assert.equal(idx, 1);
  mon.recordWaveComplete(idx);
  const metrics = mon.getWaveMetrics();
  assert.equal(metrics.length, 1);
  assert.ok(metrics[0].completedAt);
});
