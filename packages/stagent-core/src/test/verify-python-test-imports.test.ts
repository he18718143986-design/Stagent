import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, '../../scripts/verify-python-test-imports.mjs');

function runScript(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('verify-python-test-imports passes stdlib datetime and src-layout module', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-verify-imports-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'signal_detector.py'), 'class SignalDetector: pass\n');
    fs.writeFileSync(
      path.join(dir, 'tests', 'test_signal_detector.py'),
      `from datetime import datetime
from signal_detector import SignalDetector
`,
    );
    const out = runScript(dir, ['tests/test_signal_detector.py']);
    assert.equal(out.status, 0, out.stderr || out.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-python-test-imports soft-skips missing project module in pre-impl default mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-verify-imports-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests', 'test_x.py'),
      'from missing_mod import Foo\n',
    );
    const out = runScript(dir, ['tests/test_x.py']);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    assert.match(out.stdout ?? '', /pre-impl soft-skip/i);
    assert.match(out.stdout ?? '', /missing_mod/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-python-test-imports --strict fails when project module missing under src/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-verify-imports-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tests', 'test_x.py'),
      'from missing_mod import Foo\n',
    );
    const out = runScript(dir, ['--strict', 'tests/test_x.py']);
    assert.equal(out.status, 1);
    assert.match(out.stderr ?? '', /missing_mod/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-python-test-imports fails when test file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-verify-imports-'));
  try {
    const out = runScript(dir, ['tests/no_such_test.py']);
    assert.equal(out.status, 1);
    assert.match(out.stderr ?? '', /file not found/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
