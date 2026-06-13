import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, '../../scripts/ensure-python-requirements-baseline.mjs');

function runScript(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

test('ensure-python-requirements-baseline creates requirements.txt with pytest numpy pandas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-req-base-'));
  try {
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const body = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
    assert.match(body, /^pytest/m);
    assert.match(body, /numpy/);
    assert.match(body, /pandas/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensure-python-requirements-baseline merges without duplicating packages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-req-base-'));
  try {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pytest==8.0\nrequests\n');
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const lines = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8').trim().split('\n');
    const names = lines.map((l) => l.split(/[=<>]/)[0].trim().toLowerCase());
    assert.equal(names.filter((n) => n === 'pytest').length, 1);
    assert.ok(names.includes('numpy'));
    assert.ok(names.includes('pandas'));
    assert.ok(names.includes('requests'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
