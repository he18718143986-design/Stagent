import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, '../../scripts/materialize-python-module-stub.mjs');

function runScript(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('materialize-python-module-stub writes stub from wf-state decisionArtifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-stub-mat-'));
  try {
    const instDir = path.join(dir, '.stagent', 'instances', 'inst-1');
    fs.mkdirSync(instDir, { recursive: true });
    fs.writeFileSync(
      path.join(instDir, '.wf-state.json'),
      JSON.stringify({
        stageRuntimes: [
          {
            stageId: 'stage_decide_signals',
            outputs: {
              decisionArtifacts: {
                version: 1,
                files: [],
                modules: [{ name: 'signals', exports: ['compute'] }],
              },
            },
          },
        ],
      }),
    );
    const out = runScript(dir, ['signals']);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const stubPath = path.join(dir, 'signals', '__init__.py');
    assert.ok(fs.existsSync(stubPath));
    const body = fs.readFileSync(stubPath, 'utf8');
    assert.match(body, /def compute/);
    assert.match(body, /NotImplementedError/);
    assert.match(body, /__all__/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('materialize-python-module-stub uses slice decisionRecord when sidecar missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-stub-mat-'));
  try {
    const instDir = path.join(dir, '.stagent', 'instances', 'inst-2');
    fs.mkdirSync(instDir, { recursive: true });
    const record =
      '每项指标独立导出函数**：compute_ma, compute_boll, compute_vol, compute_macd, compute_cci 各司其职';
    fs.writeFileSync(
      path.join(instDir, '.wf-state.json'),
      JSON.stringify({
        stageRuntimes: [
          {
            stageId: 'stage_decide_architecture_overview',
            outputs: {
              decisionArtifacts: {
                version: 1,
                files: [],
                modules: [{ name: 'indicators', exports: ['compute'] }],
              },
            },
          },
          {
            stageId: 'stage_decide_indicators',
            outputs: {
              decisionRecord: record,
            },
          },
        ],
      }),
    );
    const out = runScript(dir, ['indicators']);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const body = fs.readFileSync(path.join(dir, 'indicators', '__init__.py'), 'utf8');
    assert.match(body, /def compute_ma/);
    assert.match(body, /def compute_boll/);
    assert.match(out.stdout, /exports=compute_boll,compute_cci,compute_ma,compute_macd,compute_vol/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('materialize-python-module-stub fails without decisionArtifacts exports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-stub-mat-'));
  try {
    const out = runScript(dir, ['signals']);
    assert.equal(out.status, 1);
    assert.match(out.stderr ?? '', /no exports/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
