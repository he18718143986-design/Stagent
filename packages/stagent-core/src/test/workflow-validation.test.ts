import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateGeneratedWorkflow } from '../WorkflowValidation';
import type { WorkflowDefinition } from '../WorkflowDefinition';

test('fails fast when file-read stage misses filePath', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_bad_file_read',
    version: '2.0',
    meta: {
      title: 'bad file-read',
      taskType: 'software',
      userInput: 'test',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_zoom_out',
        title: 'zoom out',
        tool: 'file-read',
        toolConfig: { type: 'file-read', filePath: '' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'moduleMap', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  };
  const errors = validateGeneratedWorkflow(wf);
  assert.equal(errors.some((e) => e.includes('(file-read) 缺少 filePath')), true);
});

test('fails when dependsOn references unknown stage', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_bad_dep',
    version: '2.0',
    meta: {
      title: 'x',
      taskType: 'software',
      userInput: 'x',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 's_first',
        title: 'first',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'o', format: 'text' }],
        pauseAfter: false,
        dependsOn: ['missing_stage'],
      },
    ],
  };
  const errors = validateGeneratedWorkflow(wf);
  assert.equal(errors.some((e) => e.includes('dependsOn 引用未知阶段')), true);
});

test('fails when dependsOn stage is not before consumer', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_bad_dep_order',
    version: '2.0',
    meta: {
      title: 'x',
      taskType: 'software',
      userInput: 'x',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 's_first',
        title: 'first',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'o', format: 'text' }],
        pauseAfter: false,
        dependsOn: ['s_later'],
      },
      {
        id: 's_later',
        title: 'later',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'o', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const errors = validateGeneratedWorkflow(wf);
  assert.equal(errors.some((e) => e.includes('须出现在 stages[] 中本阶段之前')), true);
});

test('fails when dependency graph has a cycle (dependsOn + stage-output)', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_cycle',
    version: '2.0',
    meta: {
      title: 'x',
      taskType: 'software',
      userInput: 'x',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 's_a',
        title: 'a',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: {
          sources: [{ type: 'stage-output', stageId: 's_c', outputKey: 'out', label: 'c' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'out', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 's_b',
        title: 'b',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'out', format: 'text' }],
        pauseAfter: false,
        dependsOn: ['s_a'],
      },
      {
        id: 's_c',
        title: 'c',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'out', format: 'text' }],
        pauseAfter: false,
        dependsOn: ['s_b'],
      },
    ],
  };
  const errors = validateGeneratedWorkflow(wf);
  assert.equal(errors.some((e) => e.includes('依赖图存在环')), true);
});

test('stage_impl_web_package_json must use output key packageJson and not be a decision stage', () => {
  const bad: WorkflowDefinition = {
    id: 'wf_web_pkg_bad',
    version: '2.0',
    meta: {
      title: 'x',
      taskType: 'software',
      userInput: 'React Vite 前端',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_web_package_json',
        title: 'package.json',
        isDecisionStage: true,
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'package.json',
          writePathBase: 'workspace',
        },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
      },
    ],
  };
  const errBad = validateGeneratedWorkflow(bad);
  assert.equal(errBad.some((e) => e.includes('不得设置 isDecisionStage=true')), true);
  assert.equal(errBad.some((e) => e.includes('必须为 "packageJson"')), true);

  const ok: WorkflowDefinition = {
    ...bad,
    stages: [
      {
        ...bad.stages[0],
        isDecisionStage: false,
        outputs: [{ key: 'packageJson', format: 'json' }],
        pauseAfter: false,
      },
    ],
  };
  const errOk = validateGeneratedWorkflow(ok);
  assert.deepEqual(errOk, []);
});

test('stage_impl_uniapp_package_json must use output key packageJson and not be a decision stage', () => {
  const bad: WorkflowDefinition = {
    id: 'wf_uniapp_pkg_bad',
    version: '2.0',
    meta: {
      title: 'x',
      taskType: 'software',
      userInput: 'uni-app 小程序',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_uniapp_package_json',
        title: 'package.json',
        isDecisionStage: true,
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'x',
          writeOutputToFile: 'package.json',
          writePathBase: 'workspace',
        },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
      },
    ],
  };
  const errBad = validateGeneratedWorkflow(bad);
  assert.equal(errBad.some((e) => e.includes('不得设置 isDecisionStage=true')), true);
  assert.equal(errBad.some((e) => e.includes('必须为 "packageJson"')), true);

  const ok: WorkflowDefinition = {
    ...bad,
    stages: [
      {
        ...bad.stages[0],
        isDecisionStage: false,
        outputs: [{ key: 'packageJson', format: 'json' }],
        pauseAfter: false,
      },
    ],
  };
  assert.deepEqual(validateGeneratedWorkflow(ok), []);
});

test('rejects code-runner command that combines tsc --noEmit with require(./out/...)', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_bad_test_run',
    version: '2.0',
    meta: { title: 'x', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 'stage_test_run_scanner',
        title: 'scanner test',
        tool: 'code-runner',
        toolConfig: {
          type: 'code-runner',
          command:
            'npm ci && npx tsc -p tsconfig.json --noEmit || true && node -e "const {scanText} = require(\\"./out/scanner\\"); console.log(scanText);"',
          captureOutput: true,
        },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  const errors = validateGeneratedWorkflow(wf);
  assert.equal(errors.some((e) => e.includes('[tsc-noemit-vs-out-dependency]')), true);
});

test('accepts code-runner npm ci then tsc compile and node out (no --noEmit)', () => {
  const wf: WorkflowDefinition = {
    id: 'wf_ok_chain',
    version: '2.0',
    meta: { title: 'x', taskType: 'software', userInput: 'x', createdAt: new Date().toISOString() },
    stages: [
      {
        id: 's_deps',
        title: 'deps',
        tool: 'code-runner',
        toolConfig: { type: 'code-runner', command: 'npm ci', captureOutput: true },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'd', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 's_test',
        title: 'test',
        tool: 'code-runner',
        toolConfig: {
          type: 'code-runner',
          command: 'npx tsc -p tsconfig.json && node ./out/test/scanner.test.js',
          captureOutput: true,
        },
        input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'log', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
  assert.deepEqual(validateGeneratedWorkflow(wf), []);
});
