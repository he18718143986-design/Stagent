import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { loadManagedPromptSlots, PromptVersionManager } from '../PromptVersionManager';
import { buildWorkflowGeneratorPrompt } from '../WorkflowPrompts';

test('buildWorkflowGeneratorPrompt uses PromptVersionManager slot overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-pvm-int-'));
  const storePath = path.join(dir, '.stagent', 'prompt-versions.json');
  const seeds = loadManagedPromptSlots(storePath);
  const mgr = new PromptVersionManager(storePath);
  mgr.setPrompt('RULE20_SYSTEM_PROMPT', `${seeds.RULE20_SYSTEM_PROMPT}\n<!-- M18 custom marker -->`, ['test']);
  const loaded = loadManagedPromptSlots(storePath);
  const prompt = buildWorkflowGeneratorPrompt('software', {
    userInput: '做一个简单 CLI',
    promptSlots: loaded,
  });
  assert.ok(prompt.includes('<!-- M18 custom marker -->'));
  assert.ok(prompt.includes('Rule 20'));
});
