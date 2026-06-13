import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  extractCommitmentSnapshot,
  parseDecisionArtifactsFromText,
} from '../commitment';

test('parseDecisionArtifactsFromText extracts JSON after marker', () => {
  const text = `# Decision

将落盘 config.yaml
<!-- decisionArtifacts:json -->
{"version":1,"files":[{"key":"configContent","path":"config.yaml","format":"yaml","content":"k: v"}],"testStack":"pytest"}`;
  const parsed = parseDecisionArtifactsFromText(text);
  assert.ok(parsed.artifacts);
  assert.equal(parsed.artifacts?.files[0].key, 'configContent');
  assert.match(parsed.markdownBody, /Decision/);
  assert.equal(parsed.warnings.length, 0);
});

test('extractCommitmentSnapshot prefers sidecar file paths over markdown parser', () => {
  const record = '将创建文件 `config.yaml`';
  const artifacts = {
    version: 1 as const,
    files: [{ key: 'configContent', path: 'config.yaml', format: 'yaml', content: 'x: 1' }],
    testStack: 'pytest' as const,
  };
  const snap = extractCommitmentSnapshot({
    stageId: 'stage_decide_x',
    decisionRecord: record,
    decisionArtifacts: artifacts,
  });
  const filePaths = snap.commitments.filter((c) => c.kind === 'file_path');
  assert.equal(filePaths.length, 1);
  assert.equal(filePaths[0].subject, 'config.yaml');
  assert.equal(filePaths[0].source, 'sidecar');
});

test('extractCommitmentSnapshot records module export symbols from sidecar', () => {
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: ['compute', 'SignalEngine'] }],
    testStack: 'pytest' as const,
  };
  const snap = extractCommitmentSnapshot({
    stageId: 'stage_decide_signals',
    decisionRecord: '模块边界',
    decisionArtifacts: artifacts,
  });
  const exports = snap.commitments.filter((c) => c.kind === 'export_symbol');
  assert.equal(exports.length, 2);
  assert.ok(exports.some((c) => c.subject === 'signals.compute'));
});

test('extractCommitmentSnapshot falls back to markdown parser without sidecar', () => {
  const record = `### 职责边界
仅实现 greet 单切片。

### 关键设计决策
落盘 src/app.py`;
  const snap = extractCommitmentSnapshot({
    stageId: 'stage_decide_x',
    decisionRecord: record,
  });
  assert.ok(snap.commitments.some((c) => c.kind === 'file_path' && c.subject === 'src/app.py'));
});
