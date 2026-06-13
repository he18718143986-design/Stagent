import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { analyzeFailurePatterns } from '../FailurePatternAnalyzer';
import { WorkflowExperienceStore } from '../WorkflowExperienceStore';

test('fixture experiences produce >=3 actionable pattern kinds', () => {
  const fixturePath = path.join(process.cwd(), 'scripts/fixtures/experiences/sample-experiences.jsonl');
  const raw = fs.readFileSync(fixturePath, 'utf-8');
  const experiences = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const report = analyzeFailurePatterns(experiences);
  const kinds = new Set(report.patterns.map((p) => p.kind));
  assert.ok(kinds.size >= 3);
});

test('analyze-experiences script runs on fixture workspace copy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-analyze-'));
  fs.mkdirSync(path.join(tmp, '.stagent'), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'scripts/fixtures/experiences/sample-experiences.jsonl'),
    path.join(tmp, '.stagent', 'experiences.jsonl'),
  );
  const out = execSync(`npx ts-node scripts/analyze-experiences.ts --workspace "${tmp}"`, {
    encoding: 'utf-8',
  });
  assert.ok(out.includes('Actionable pattern kinds'));
  const store = new WorkflowExperienceStore(path.join(tmp, '.stagent', 'experiences.jsonl'));
  const report = analyzeFailurePatterns(store.readAll());
  assert.ok(new Set(report.patterns.map((p) => p.kind)).size >= 3);
});
