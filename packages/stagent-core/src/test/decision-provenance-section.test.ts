import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendDecisionProvenanceToRecord,
  formatDecisionProvenanceSection,
  stripDecisionProvenanceSection,
} from '../charter/formatDecisionProvenanceSection';

test('formatDecisionProvenanceSection includes stage and per-question map', () => {
  const section = formatDecisionProvenanceSection({
    stageId: 'stage_decide_x',
    provenance: 'charter_inferred',
    perQuestion: { q1: 'charter_direct', q2: 'human' },
  });
  assert.match(section, /### 决策溯源/);
  assert.match(section, /stageId: stage_decide_x/);
  assert.match(section, /provenance: charter_inferred/);
  assert.match(section, /q1: charter_direct/);
  assert.match(section, /q2: human/);
});

test('stripDecisionProvenanceSection is idempotent', () => {
  const body = '### 职责边界\n- A';
  const section = formatDecisionProvenanceSection({
    stageId: 'stage_decide_x',
    provenance: 'human',
  });
  const once = appendDecisionProvenanceToRecord(body, section);
  const twice = appendDecisionProvenanceToRecord(once, section);
  assert.equal(once, twice);
  assert.equal(stripDecisionProvenanceSection(twice), body);
});
