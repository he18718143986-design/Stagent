import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  collectAllCodeRunnerLintIssues,
  detectCodeRunnerCommandIssues,
  detectImportMetaUrlVsCommonJsWorkspace,
} from '../CodeRunnerCommandLint';
import type { WorkflowDefinition } from '../WorkflowDefinition';

test('detect: tsc --noEmit + require(./out/...) (M14 scanner case)', () => {
  const cmd = `npx tsc -p tsconfig.json --noEmit || true && node -e "const {scanText} = require('./out/scanner'); console.log('ok');"`;
  const issues = detectCodeRunnerCommandIssues(cmd);
  assert.ok(issues.some((i) => i.code === 'tsc-noemit-vs-out-dependency'));
});

test('detect: tsc --noEmit + node ./out/test.js (no require) also triggers', () => {
  const cmd = 'npm ci && npx tsc -p tsconfig.json --pretty --noEmit && node ./out/test/scanner.test.js';
  const issues = detectCodeRunnerCommandIssues(cmd);
  assert.ok(issues.some((i) => i.code === 'tsc-noemit-vs-out-dependency'));
});

test('clean: tsc -p ./ (no --noEmit) then node ./out is allowed', () => {
  const cmd = 'npm ci && npx tsc -p tsconfig.json && node ./out/test/scanner.test.js';
  assert.deepEqual(detectCodeRunnerCommandIssues(cmd), []);
});

test('clean: ts-node directly running .ts source is allowed', () => {
  const cmd = 'npx ts-node src/scanner.test.ts';
  assert.deepEqual(detectCodeRunnerCommandIssues(cmd), []);
});

test('clean: npm test is allowed (scripts opaque to the linter)', () => {
  const cmd = 'npm test';
  assert.deepEqual(detectCodeRunnerCommandIssues(cmd), []);
});

test('clean: tsc --noEmit alone (pure type-check) is allowed', () => {
  const cmd = 'npm ci && npx tsc -p tsconfig.json --noEmit';
  assert.deepEqual(detectCodeRunnerCommandIssues(cmd), []);
});

test('detect is robust against extra flags between tsc and --noEmit', () => {
  const cmd = 'npm ci && npx tsc -p tsconfig.json --pretty --noEmit && node -e "require(\\"./out/scanner\\")"';
  const issues = detectCodeRunnerCommandIssues(cmd);
  assert.ok(issues.some((i) => i.code === 'tsc-noemit-vs-out-dependency'));
});

test('handles empty / non-string input safely', () => {
  assert.deepEqual(detectCodeRunnerCommandIssues(''), []);
});

test('detect: tsc-without-npx when command starts with bare tsc', () => {
  const issues = detectCodeRunnerCommandIssues('tsc -p tsconfig.json --noEmit');
  assert.ok(issues.some((i) => i.code === 'tsc-without-npx'));
});

test('detect: bare-tsc-without-project for npx tsc without -p/--project/-b', () => {
  const issues = detectCodeRunnerCommandIssues('npx tsc --noEmit');
  assert.ok(issues.some((i) => i.code === 'bare-tsc-without-project'));
  assert.equal(
    issues.some((i) => i.code === 'tsc-without-npx'),
    false,
    'npx tsc should not trigger tsc-without-npx',
  );
});

test('clean: npx tsc -p satisfies project + launcher rules', () => {
  assert.deepEqual(detectCodeRunnerCommandIssues('npm ci && npx tsc -p tsconfig.json --noEmit'), []);
});

test('workflow: missing-npm-install-before-tsc when no prior install stage', () => {
  const wf: WorkflowDefinition = {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 's1',
        title: 'compile',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npx tsc -p tsconfig.json --noEmit', captureOutput: true },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const issues = collectAllCodeRunnerLintIssues('npx tsc -p tsconfig.json --noEmit', wf, 0);
  assert.ok(issues.some((i) => i.code === 'missing-npm-install-before-tsc'));
});

test('workflow: prior npm ci stage clears missing-npm-install-before-tsc', () => {
  const wf: WorkflowDefinition = {
    id: 'w',
    version: '2.0',
    meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 's0',
        title: 'deps',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm ci', captureOutput: true },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 's1',
        title: 'compile',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npx tsc -p tsconfig.json --noEmit', captureOutput: true },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'log2', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const issues = collectAllCodeRunnerLintIssues('npx tsc -p tsconfig.json --noEmit', wf, 1);
  assert.equal(
    issues.some((i) => i.code === 'missing-npm-install-before-tsc'),
    false,
  );
});

test('import-meta-url-with-commonjs when tsconfig is commonjs and src uses import.meta', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-crlint-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'CommonJS' } }),
      'utf-8',
    );
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'm.ts'), 'export const u = import.meta.url;\n', 'utf-8');
    const im = detectImportMetaUrlVsCommonJsWorkspace(tmp);
    assert.equal(im.length, 1);
    assert.equal(im[0].code, 'import-meta-url-with-commonjs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('collectAll merges workflow import-meta with command rules', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-crlint-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'CommonJS' } }),
      'utf-8',
    );
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'm.ts'), 'console.log(import.meta.url)\n', 'utf-8');
    const wf: WorkflowDefinition = {
      id: 'w',
      version: '2.0',
      meta: {
        title: 't',
        taskType: 'software',
        userInput: 'u',
        createdAt: new Date().toISOString(),
        taskWorkspacePath: tmp,
      },
      stages: [
        {
          id: 's1',
          title: 'tsc',
          tool: 'code-runner',
          toolConfig: {
            type: 'code-runner',
            command: 'npm ci && npx tsc -p tsconfig.json --noEmit',
            captureOutput: true,
          },
          input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
          outputs: [{ key: 'log', format: 'text' }],
          pauseAfter: false,
        },
      ],
    };
    const issues = collectAllCodeRunnerLintIssues('npm ci && npx tsc -p tsconfig.json --noEmit', wf, 0);
    assert.ok(issues.some((i) => i.code === 'import-meta-url-with-commonjs'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
