import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  canSuggestFromCharterMatch,
  enrichQuestionsWithCharterSuggest,
  formatSuggestedAnswerFromMatch,
} from '../charter/enrichQuestionsWithCharterSuggest';
import { parseCharterMarkdown } from '../charter/CharterParser';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';
import type { ConfigPort } from '../platform/PlatformAdapter';

const CHARTER_MD = `## 避免（Avoid）
- 避免为减文件数而合并 unrelated seam
## 约束（Constraints）
- 必须支持 node 18 运行时`;

function bindCharterConfig(mode: string, relativePath = 'charter.md'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-charter-enrich-'));
  fs.writeFileSync(path.join(dir, relativePath), CHARTER_MD, 'utf8');
  const port: ConfigPort = {
    get<T>(key: string, defaultValue?: T): T | undefined {
      if (key === 'charter.enabled') {
        return true as T;
      }
      if (key === 'charter.autoAnswerMode') {
        return mode as T;
      }
      if (key === 'charter.path') {
        return relativePath as T;
      }
      return defaultValue;
    },
  };
  bindStagentConfigPort(port);
  return dir;
}

test('formatSuggestedAnswerFromMatch uses proposal without provenance tag', () => {
  const text = formatSuggestedAnswerFromMatch({
    kind: 'auto',
    provenance: 'charter_direct',
    matchScore: 1,
    conflictScore: 0,
    ruleRefs: [2],
    proposal: '不要合并 seam',
    reasoning: '主旨直接命中',
  });
  assert.equal(text, '不要合并 seam（主旨直接命中）');
  assert.doesNotMatch(String(text), /\[provenance:/);
});

test('canSuggestFromCharterMatch blocks escalated and uncovered', () => {
  assert.equal(
    canSuggestFromCharterMatch({
      kind: 'uncovered',
      provenance: 'escalated',
      matchScore: 0,
      conflictScore: 0,
      ruleRefs: [],
    }),
    false,
  );
  assert.equal(
    canSuggestFromCharterMatch({
      kind: 'auto',
      provenance: 'charter_inferred',
      matchScore: 0.7,
      conflictScore: 0,
      ruleRefs: [1],
      proposal: '倾向保留 seam',
    }),
    true,
  );
});

test('enrichQuestionsWithCharterSuggest attaches fields in suggest mode', () => {
  const workspace = bindCharterConfig('suggest', 'charter.md');
  const enriched = enrichQuestionsWithCharterSuggest(
    [{ id: 'q1', text: '是否应该合并 unrelated seam 来减文件？', required: true }],
    workspace,
  );
  assert.equal(enriched.length, 1);
  assert.ok(enriched[0]!.suggestedAnswer);
  assert.equal(enriched[0]!.provenance, 'charter_direct');
  assert.ok((enriched[0]!.ruleRefs?.length ?? 0) > 0);
});

test('enrichQuestionsWithCharterSuggest no-op in off mode', () => {
  const workspace = bindCharterConfig('off', 'charter.md');
  const questions = [{ id: 'q1', text: '是否应该合并 unrelated seam？', required: true }];
  const enriched = enrichQuestionsWithCharterSuggest(questions, workspace);
  assert.deepEqual(enriched, questions);
});
