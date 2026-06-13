import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractJsonObject, extractJsonValue, isLikelyTruncatedJson } from '../JsonExtract';

test('extractJsonObject picks first parseable object from mixed text', () => {
  const raw = `解释文本 {invalid json} 继续说明 {"id":"wf_ok","version":"2.0","meta":{"title":"x","taskType":"software","userInput":"u","createdAt":"2026-05-08T00:00:00.000Z"},"stages":[]}`;
  const out = extractJsonObject(raw);
  assert.ok(out);
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, 'wf_ok');
});

test('extractJsonObject prefers fenced json block when valid', () => {
  const raw = `before\n\`\`\`json\n{"id":"wf_fenced","version":"2.0","meta":{"title":"x","taskType":"software","userInput":"u","createdAt":"2026-05-08T00:00:00.000Z"},"stages":[]}\n\`\`\`\nafter`;
  const out = extractJsonObject(raw);
  assert.ok(out);
  const parsed = JSON.parse(out);
  assert.equal(parsed.id, 'wf_fenced');
});

test('extractJsonValue extracts a fenced JSON array (PatchInstruction[])', () => {
  const raw =
    '这是补丁：\n```json\n[{"search":"a","replace":"b","filePath":"f.ts"}]\n```\n完成';
  const out = extractJsonValue(raw);
  assert.ok(out);
  const parsed = JSON.parse(out) as Array<{ filePath: string }>;
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed[0].filePath, 'f.ts');
});

test('extractJsonObject ignores top-level arrays (object-only)', () => {
  assert.equal(extractJsonObject('[1,2,3]'), undefined);
  assert.ok(extractJsonValue('[1,2,3]'));
});

test('isLikelyTruncatedJson detects unbalanced / mid-string truncation', () => {
  assert.equal(isLikelyTruncatedJson('{"a":1,"b":{"c":2'), true);
  assert.equal(isLikelyTruncatedJson('```json\n{"a":"unterminated'), true);
  assert.equal(isLikelyTruncatedJson('{"a":1}'), false);
  assert.equal(isLikelyTruncatedJson('completely non json prose'), false);
});
