import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseDelimitedMultiFileOutput,
  resolvePrimaryWriteContent,
} from '../stage-runners/llm-persist/multiFileOutputParse';

test('parseDelimitedMultiFileOutput splits file blocks', () => {
  const text = `--- file: indicators.py ---
def compute_ma():
    return 1

--- file: requirements.txt ---
pytest
numpy
`;
  const parsed = parseDelimitedMultiFileOutput(text);
  assert.equal(parsed.files.get('indicators.py'), 'def compute_ma():\n    return 1');
  assert.equal(parsed.files.get('requirements.txt'), 'pytest\nnumpy');
});

test('resolvePrimaryWriteContent extracts primary and additional', () => {
  const text = `--- file: indicators.py ---
def compute_ma():
    return 2

--- file: requirements.txt ---
pytest
`;
  const { primaryContent, additionalFiles } = resolvePrimaryWriteContent(
    'indicators.py',
    text,
    ['requirements.txt'],
  );
  assert.match(primaryContent, /return 2/);
  assert.equal(additionalFiles.get('requirements.txt'), 'pytest');
});

test('resolvePrimaryWriteContent falls back to single file body', () => {
  const { primaryContent, additionalFiles } = resolvePrimaryWriteContent(
    'indicators.py',
    'def compute_ma():\n    pass\n',
    ['requirements.txt'],
  );
  assert.match(primaryContent, /compute_ma/);
  assert.equal(additionalFiles.size, 0);
});
