import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage } from '../WorkflowDefinition';
import { emitStageDoneAdvancePersist } from '../WorkflowEngineContinuation';

test('emitStageDoneAdvancePersist omit matches legacy approve message shape', () => {
  const out: BackendMessage[] = [];
  let bumped = false;
  let saved = false;
  emitStageDoneAdvancePersist({
    emit: (m) => out.push(m),
    stageId: 's1',
    decisionUiFlag: 'omit',
    bumpStageIndex: () => {
      bumped = true;
    },
    scheduleSave: () => {
      saved = true;
    },
  });
  assert.deepEqual(out[0], { type: 'stageStatusUpdate', stageId: 's1', status: 'done' });
  assert.equal(bumped, true);
  assert.equal(saved, true);
});

test('emitStageDoneAdvancePersist includes isDecisionStage when boolean', () => {
  const out: BackendMessage[] = [];
  emitStageDoneAdvancePersist({
    emit: (m) => out.push(m),
    stageId: 's2',
    decisionUiFlag: false,
    bumpStageIndex: () => {},
    scheduleSave: () => {},
  });
  assert.deepEqual(out[0], {
    type: 'stageStatusUpdate',
    stageId: 's2',
    status: 'done',
    isDecisionStage: false,
  });
});
