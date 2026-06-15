import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { uiMsg } from '../l10n/uiStrings';

test('execution error-catalog keys resolve to localized copy (no raw key leak)', () => {
  const keys = [
    'stagent.error.catalog.fallback.title',
    'stagent.error.catalog.invariantViolation.title',
    'stagent.error.catalog.invariantViolation.hint',
    'stagent.error.catalog.invariantViolation.playbook.1',
    'stagent.error.catalog.commandFailedCode.title',
    'stagent.error.catalog.commandFailedCode.body',
    'stagent.error.catalog.commandFailedCode.playbook.1',
    'stagent.error.catalog.toolExecutionFailed.title',
    'stagent.error.catalog.toolExecutionFailed.hint',
    'stagent.error.catalog.commandNotFound.titleGeneric',
    'stagent.error.catalog.commandNotFound.bodyGeneric',
  ];
  for (const key of keys) {
    const v = uiMsg(key);
    assert.notEqual(v, key, `expected localized copy for ${key}`);
    assert.ok(v.length > 0);
  }
});

test('templated error-catalog keys substitute arguments', () => {
  assert.match(uiMsg('stagent.error.catalog.commandNotFound.title', 'flutter'), /flutter/);
  assert.match(uiMsg('stagent.error.catalog.commandNotFound.body', 'flutter'), /flutter/);
});
