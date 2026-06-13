import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  hasCharterSuggestionsPendingConfirm,
  prefillQuestionBeforeFromCharter,
} from '../charter/CharterGrillRuntime';
import { shouldSilentPrefillFromCharter } from '../charter/CharterGrillAutoAnswer';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';
import type { ConfigPort } from '../platform/PlatformAdapter';
import type { StageRuntime } from '../WorkflowDefinition';

const CHARTER_MD = `## 避免（Avoid）
- 避免为减文件数而合并 unrelated seam`;

function bindMode(mode: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-charter-runtime-'));
  fs.writeFileSync(path.join(dir, 'charter.md'), CHARTER_MD, 'utf8');
  bindStagentConfigPort({
    get<T>(key: string, defaultValue?: T): T | undefined {
      if (key === 'charter.enabled') {
        return true as T;
      }
      if (key === 'charter.autoAnswerMode') {
        return mode as T;
      }
      if (key === 'charter.path') {
        return 'charter.md' as T;
      }
      return defaultValue;
    },
  } satisfies ConfigPort);
  return dir;
}

test('shouldSilentPrefillFromCharter only true for auto-with-escalation', () => {
  assert.equal(shouldSilentPrefillFromCharter('auto-with-escalation'), true);
  assert.equal(shouldSilentPrefillFromCharter('suggest'), false);
  assert.equal(shouldSilentPrefillFromCharter('off'), false);
});

test('prefillQuestionBeforeFromCharter: suggest does not write runtime', () => {
  const workspace = bindMode('suggest');
  const runtime: Pick<StageRuntime, 'questionBeforeAnswers' | 'charterQuestionProvenance'> = {};
  const changed = prefillQuestionBeforeFromCharter({
    questions: [{ id: 'q1', text: '是否应该合并 unrelated seam？', required: true }],
    answers: {},
    runtime,
    workspaceRoot: workspace,
  });
  assert.equal(changed, false);
  assert.equal(runtime.questionBeforeAnswers, undefined);
});

test('prefillQuestionBeforeFromCharter: auto-with-escalation silent prefill', () => {
  const workspace = bindMode('auto-with-escalation');
  const runtime: Pick<StageRuntime, 'questionBeforeAnswers' | 'charterQuestionProvenance'> = {};
  const changed = prefillQuestionBeforeFromCharter({
    questions: [{ id: 'q1', text: '是否应该合并 unrelated seam？', required: true }],
    answers: {},
    runtime,
    workspaceRoot: workspace,
  });
  assert.equal(changed, true);
  assert.ok(String(runtime.questionBeforeAnswers?.q1 ?? '').trim().length > 0);
  assert.equal(runtime.charterQuestionProvenance?.q1, 'charter_direct');
});

test('hasCharterSuggestionsPendingConfirm true in suggest when charter matches', () => {
  const workspace = bindMode('suggest');
  assert.equal(
    hasCharterSuggestionsPendingConfirm(
      [{ id: 'q1', text: '是否应该合并 unrelated seam？', required: true }],
      {},
      workspace,
    ),
    true,
  );
});

test('hasCharterSuggestionsPendingConfirm false when answers already present', () => {
  const workspace = bindMode('suggest');
  assert.equal(
    hasCharterSuggestionsPendingConfirm(
      [{ id: 'q1', text: '是否应该合并 unrelated seam？', required: true }],
      { q1: '已答' },
      workspace,
    ),
    false,
  );
});
