import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PromptVersionManager } from '../PromptVersionManager';
import { getManagedPromptSeeds } from '../WorkflowPrompts';

test('PromptVersionManager seeds protected and mutable slots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-pvm-'));
  const storePath = path.join(dir, '.stagent', 'prompt-versions.json');
  const mgr = new PromptVersionManager(storePath);
  const seeds = getManagedPromptSeeds();
  assert.ok(mgr.getPrompt('RULE20_SYSTEM_PROMPT').includes('Rule 20'));
  assert.equal(mgr.getPrompt('DECISION_RECORD_STRICT_SUFFIX'), seeds.DECISION_RECORD_STRICT_SUFFIX.content);
  assert.throws(() => mgr.setPrompt('DECISION_RECORD_STRICT_SUFFIX', 'mutated'), /prompt-slot-protected/);
});

test('PromptVersionManager setPrompt and rollback for mutable slot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-pvm-'));
  const storePath = path.join(dir, '.stagent', 'prompt-versions.json');
  const mgr = new PromptVersionManager(storePath);
  const before = mgr.getPrompt('RULE20_SYSTEM_PROMPT');
  mgr.setPrompt('RULE20_SYSTEM_PROMPT', `${before}\n<!-- v2 -->`, ['test']);
  assert.ok(mgr.getPrompt('RULE20_SYSTEM_PROMPT').includes('<!-- v2 -->'));
  const slot = mgr.getSlot('RULE20_SYSTEM_PROMPT');
  assert.ok(slot);
  const firstId = slot!.history[0].id;
  mgr.rollback('RULE20_SYSTEM_PROMPT', firstId);
  assert.equal(mgr.getPrompt('RULE20_SYSTEM_PROMPT'), before);
});

test('PromptVersionManager persists to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-pvm-'));
  const storePath = path.join(dir, '.stagent', 'prompt-versions.json');
  const mgr = new PromptVersionManager(storePath);
  mgr.setPrompt('RULE20_SYSTEM_PROMPT', 'custom-rule20', ['persist']);
  const mgr2 = new PromptVersionManager(storePath);
  assert.equal(mgr2.getPrompt('RULE20_SYSTEM_PROMPT'), 'custom-rule20');
  assert.ok(fs.existsSync(storePath));
});
