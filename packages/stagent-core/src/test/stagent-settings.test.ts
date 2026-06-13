import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_CONFIDENCE_PAUSE_THRESHOLD,
  DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES,
  resolveConfidencePauseThreshold,
  resolveMemoryMaxExperienceEntries,
  resolveCodebaseContextMaxTokens,
  resolveDagMaxParallelism,
  DEFAULT_DAG_MAX_PARALLELISM,
} from '../StagentSettingsDefaults';

test('resolveConfidencePauseThreshold accepts 0-1 and falls back', () => {
  assert.equal(resolveConfidencePauseThreshold(0.4), 0.4);
  assert.equal(resolveConfidencePauseThreshold(0), 0);
  assert.equal(resolveConfidencePauseThreshold(1), 1);
  assert.equal(resolveConfidencePauseThreshold(-0.1), DEFAULT_CONFIDENCE_PAUSE_THRESHOLD);
  assert.equal(resolveConfidencePauseThreshold(1.5), DEFAULT_CONFIDENCE_PAUSE_THRESHOLD);
  assert.equal(resolveConfidencePauseThreshold('0.4'), DEFAULT_CONFIDENCE_PAUSE_THRESHOLD);
});

test('resolveMemoryMaxExperienceEntries accepts positive integers and falls back', () => {
  assert.equal(resolveMemoryMaxExperienceEntries(500), 500);
  assert.equal(resolveMemoryMaxExperienceEntries(1.9), 1);
  assert.equal(resolveMemoryMaxExperienceEntries(0), DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES);
  assert.equal(resolveMemoryMaxExperienceEntries(undefined), DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES);
});

test('resolveDagMaxParallelism defaults to 2', () => {
  assert.equal(resolveDagMaxParallelism(undefined), DEFAULT_DAG_MAX_PARALLELISM);
  assert.equal(resolveDagMaxParallelism(3), 3);
});
