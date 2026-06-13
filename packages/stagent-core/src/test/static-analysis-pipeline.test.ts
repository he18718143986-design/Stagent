import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  analysisResultsToWarningLines,
  buildDefaultWorkspaceChecks,
  runStaticAnalysis,
  suggestVerificationStages,
} from '../StaticAnalysisPipeline';
import type { Stage } from '../WorkflowDefinition';

test('runStaticAnalysis uses injected runCommand mock', async () => {
  const results = await runStaticAnalysis(
    [{ type: 'custom', command: 'echo ok' }],
    '/tmp',
    5000,
    async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
});

test('analysisResultsToWarningLines flags failed checks', () => {
  const lines = analysisResultsToWarningLines([
    {
      check: { type: 'typescript', tsconfigPath: 'tsconfig.json' },
      passed: false,
      errors: ['error TS1000'],
      warnings: [],
      durationMs: 1,
    },
  ]);
  assert.deepEqual(lines, ['static-analysis:typescript:failed']);
});

test('suggestVerificationStages proposes tsc stage when tsc failed', () => {
  const stages: Stage[] = [];
  const suggested = suggestVerificationStages(
    [
      {
        check: { type: 'typescript', tsconfigPath: 'tsconfig.json' },
        passed: false,
        errors: ['err'],
        warnings: [],
        durationMs: 1,
      },
    ],
    stages,
  );
  assert.equal(suggested.length, 1);
  assert.equal(suggested[0].id, 'stage_verify_tsc_suggested');
});

test('imports check resolves relative paths in workspace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-sa-imports-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'extension.ts'),
    "import { foo } from './missing';\nexport const x = foo;\n",
  );
  const results = await runStaticAnalysis([{ type: 'imports', entryPoint: 'src/extension.ts' }], dir);
  assert.equal(results[0].skipped, false);
  assert.equal(results[0].passed, false);
  assert.ok(results[0].errors.some((e) => e.includes('missing')));
});

test('imports check passes when targets exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-sa-imports-ok-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'util.ts'), 'export const u = 1;\n');
  fs.writeFileSync(
    path.join(dir, 'src', 'extension.ts'),
    "import { u } from './util';\nexport const x = u;\n",
  );
  const results = await runStaticAnalysis([{ type: 'imports', entryPoint: 'src/extension.ts' }], dir);
  assert.equal(results[0].passed, true);
});

test('buildDefaultWorkspaceChecks includes tsc and imports when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-sa-default-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
  fs.writeFileSync(path.join(dir, 'src', 'extension.ts'), 'export {};\n');
  const checks = buildDefaultWorkspaceChecks(dir);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].type, 'typescript');
  assert.equal(checks[1].type, 'imports');
});
