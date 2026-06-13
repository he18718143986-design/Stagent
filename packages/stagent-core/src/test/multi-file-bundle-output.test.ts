import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseMultiFileBundleOutput,
  stripCodeFences,
} from '../stage-runners/llm-persist/multiFileBundleOutput';

const SAMPLE_KEYS = [
  'file_config.yaml',
  'file_indicators/__init__.py',
  'file_indicators/ma.py',
  'file_main.py',
] as const;

test('stripCodeFences removes markdown fences', () => {
  assert.equal(stripCodeFences('```yaml\na: 1\n```'), 'a: 1');
});

test('parseMultiFileBundleOutput splits T4-style bundle', () => {
  const samplePath = path.join(
    process.cwd(),
    '../../../T4/.stagent/generated/stage_impl_mvp.md',
  );
  if (!fs.existsSync(samplePath)) {
    return;
  }
  const text = fs.readFileSync(samplePath, 'utf8');
  const parsed = parseMultiFileBundleOutput(text, SAMPLE_KEYS);
  assert.match(parsed['file_config.yaml'] ?? '', /^#\s*交易系统配置/m);
  assert.match(parsed['file_indicators/__init__.py'] ?? '', /from \.ma import calculate_ma/);
  assert.match(parsed['file_indicators/ma.py'] ?? '', /def calculate_ma/);
  assert.match(parsed['file_main.py'] ?? '', /if __name__/);
});

test('parseMultiFileBundleOutput handles inline sample', () => {
  const text = [
    'file_config.yaml',
    '```yaml',
    'ma_short: 5',
    '```',
    '',
    'file_main.py',
    '```python',
    'def main():',
    '    pass',
    '```',
  ].join('\n');
  const parsed = parseMultiFileBundleOutput(text, ['file_config.yaml', 'file_main.py']);
  assert.equal(parsed['file_config.yaml'], 'ma_short: 5');
  assert.match(parsed['file_main.py'] ?? '', /def main/);
});
