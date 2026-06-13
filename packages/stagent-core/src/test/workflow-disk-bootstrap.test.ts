import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  STAGE_INIT_NPM_WORKSPACE_ID,
  applySoftwareDiskPipeline,
  injectFileWriteAfterImplStages,
  injectInitNpmWorkspaceStage,
  patchNpmDefaultTestScriptAfterInit,
} from '../WorkflowDiskBootstrap';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';

function minimalSoftwareWf(stages: Stage[]): WorkflowDefinition {
  return {
    id: 'wf_t',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
    stages,
  };
}

test('injectInitNpmWorkspaceStage prepends stable id once', () => {
  const impl: Stage = {
    id: 'stage_impl_x',
    title: 'impl',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'text', format: 'text' }],
    pauseAfter: false,
  };
  const s = injectInitNpmWorkspaceStage([impl]);
  assert.equal(s[0].id, STAGE_INIT_NPM_WORKSPACE_ID);
  assert.equal(s[0].tool, 'code-runner');
  assert.equal((s[0].toolConfig as { pathBase?: string }).pathBase, 'workspace');
  assert.equal(s.length, 2);
  assert.deepEqual(injectInitNpmWorkspaceStage(s), s);
});

test('injectFileWriteAfterImplStages inserts file-write with sourceStageId', () => {
  const impl: Stage = {
    id: 'stage_impl_slice',
    title: 'impl',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'implementationCode', format: 'text' }],
    pauseAfter: false,
  };
  const out = injectFileWriteAfterImplStages([impl]);
  assert.equal(out.length, 2);
  assert.equal(out[1].tool, 'file-write');
  const tc = out[1].toolConfig as { sourceStageId?: string; pathBase?: string; filePath?: string };
  assert.equal(tc.sourceStageId, 'stage_impl_slice');
  assert.equal(tc.pathBase, 'workspace');
  assert.match(tc.filePath ?? '', /stage_impl_slice/);
});

test('patchNpmDefaultTestScriptAfterInit replaces npm default test only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-patch-'));
  try {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: 'x',
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    assert.equal(patchNpmDefaultTestScriptAfterInit(dir), true);
    const next = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts: { test: string } };
    assert.match(next.scripts.test, /process\.exit\(0\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchNpmDefaultTestScriptAfterInit leaves custom test script', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-patch-'));
  try {
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: 'x', scripts: { test: 'jest' } }, null, 2) + '\n',
      'utf-8',
    );
    assert.equal(patchNpmDefaultTestScriptAfterInit(dir), false);
    const next = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts: { test: string } };
    assert.equal(next.scripts.test, 'jest');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applySoftwareDiskPipeline composes init + bundle + test_run pathBase', () => {
  const wf = minimalSoftwareWf([
    {
      id: 'stage_impl_a',
      title: 'a',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 's' },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'implementationCode', format: 'text' }],
      pauseAfter: false,
    },
    {
      id: 'stage_test_run_a',
      title: 'run',
      tool: 'code-runner',
      toolConfig: { type: 'code-runner', command: 'npm test', captureOutput: true },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'testResults', format: 'json' }],
      pauseAfter: false,
    },
  ]);
  const next = applySoftwareDiskPipeline(wf);
  assert.equal(next.stages[0].id, STAGE_INIT_NPM_WORKSPACE_ID);
  const run = next.stages.find((s) => s.id === 'stage_test_run_a');
  assert.ok(run);
  assert.equal((run!.toolConfig as { pathBase?: string }).pathBase, 'workspace');
});

test('applySoftwareDiskPipeline strips npm bootstrap for express+python pytest plan', () => {
  const wf = minimalSoftwareWf([
    {
      id: STAGE_INIT_NPM_WORKSPACE_ID,
      title: 'init npm',
      tool: 'code-runner',
      toolConfig: { type: 'code-runner', command: 'npm init -y', captureOutput: true },
      input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'npmInitLog', format: 'text' }],
      pauseAfter: false,
    },
    {
      id: 'stage_impl_slice_main',
      title: 'impl',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 's' },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'implementation', format: 'text' }],
      pauseAfter: false,
    },
    {
      id: 'stage_npm_install_server',
      title: 'npm install',
      tool: 'code-runner',
      toolConfig: { type: 'code-runner', command: 'cd server && npm install', captureOutput: true },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'verifyOut', format: 'text' }],
      pauseAfter: false,
    },
    {
      id: 'stage_test_run_slice_main',
      title: 'pytest',
      tool: 'code-runner',
      toolConfig: { type: 'code-runner', command: 'python -m pytest tests/ -v', captureOutput: true },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'testResults', format: 'json' }],
      pauseAfter: false,
    },
  ]);
  wf.globalConfig = { language: 'python' };
  const next = applySoftwareDiskPipeline(wf);
  assert.ok(!next.stages.some((s) => s.id === STAGE_INIT_NPM_WORKSPACE_ID));
  assert.ok(!next.stages.some((s) => s.id === 'stage_npm_install_server'));
  const run = next.stages.find((s) => s.id === 'stage_test_run_slice_main');
  assert.ok(run);
  const cmd = (run!.toolConfig as { command?: string }).command ?? '';
  assert.match(cmd, /\.venv\/bin\/python -m pytest/);
});

test('applySoftwareDiskPipeline handles undefined stages without throwing', () => {
  const wf = {
    id: 'wf_missing',
    version: '2.0',
    meta: {
      title: 'missing stages',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
  } as unknown as WorkflowDefinition;
  const next = applySoftwareDiskPipeline(wf);
  assert.ok(Array.isArray(next.stages));
  assert.equal(next.stages.length, 1);
  assert.equal(next.stages[0]?.id, 'stage_init_npm_workspace');
});
