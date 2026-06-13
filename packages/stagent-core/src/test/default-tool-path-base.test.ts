import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DEFAULT_TOOL_PATH_BASE } from '../WorkflowDefinition';

test('DEFAULT_TOOL_PATH_BASE is workspace (#7 产物默认落 workspace)', () => {
  assert.equal(DEFAULT_TOOL_PATH_BASE, 'workspace');
});
