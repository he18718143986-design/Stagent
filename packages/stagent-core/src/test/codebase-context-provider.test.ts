import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  applySnapshotDegradation,
  buildCodebaseSnapshot,
  detectProjectType,
  estimateTextTokens,
  formatSnapshotForPrompt,
} from '../CodebaseContextProvider';

test('buildCodebaseSnapshot without package.json returns unknown project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-ccp-'));
  const snap = buildCodebaseSnapshot(dir);
  assert.equal(snap.projectType, 'unknown');
  assert.equal(snap.existingModules.length, 0);
  assert.equal(snap.level, 'full');
});

test('buildCodebaseSnapshot reads package.json and source files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-ccp-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { test: 'node test.js' }, dependencies: { express: '4' } }),
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export function hello() { return 1; }\n');
  const snap = buildCodebaseSnapshot(dir);
  assert.equal(snap.projectType, 'node');
  assert.ok(snap.packageJson);
  assert.ok(snap.existingModules.some((m) => m.path.includes('index.ts')));
});

test('applySnapshotDegradation truncates large repos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-ccp-big-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (let i = 0; i < 120; i += 1) {
    fs.writeFileSync(
      path.join(dir, 'src', `mod${i}.ts`),
      `export const v${i} = ${i};\n`.repeat(40),
    );
  }
  const snap = buildCodebaseSnapshot(dir, { maxModules: 120 });
  const full = formatSnapshotForPrompt(snap, 'full');
  assert.ok(estimateTextTokens(full) > 50);
  const degraded = applySnapshotDegradation(snap, 200);
  assert.ok(['summary', 'filenames-only', 'omit'].includes(degraded.level));
  assert.ok(estimateTextTokens(degraded.text) <= 200 || degraded.level === 'omit');
});

test('detectProjectType recognizes react deps', () => {
  assert.equal(detectProjectType({ dependencies: { react: '18' } }), 'react');
});
