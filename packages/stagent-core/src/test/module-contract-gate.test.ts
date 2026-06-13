import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GateResult, QualityGateContext } from '../QualityGate';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { BUILTIN_POST_STAGE_GATES } from '../quality-gates/postStageGates';
import { GATE_ID_MODULE_CONTRACT_TEST_WRITE } from '../QualityGateIds';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { testWriteStageIdFromSemanticName } from '../workflow/StageIdPatterns';

const moduleContractGate = BUILTIN_POST_STAGE_GATES.find((g) => g.id === GATE_ID_MODULE_CONTRACT_TEST_WRITE)!;

function evalSync(ctx: QualityGateContext): GateResult | null {
  const raw = moduleContractGate.evaluate!(ctx);
  if (raw instanceof Promise) {
    throw new Error('expected sync gate evaluate');
  }
  return raw;
}

function makeGateCtx(opts: {
  mode: 'off' | 'warn' | 'hard';
  semantic: string;
  exports: string[];
  testBody: string;
}): QualityGateContext {
  const testPath = `tests/test_${opts.semantic}.py`;
  const stage: Stage = {
    id: testWriteStageIdFromSemanticName(opts.semantic)!,
    title: 'tw',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'write test',
      writeOutputToFile: testPath,
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
  const decideId = `stage_decide_${opts.semantic}`;
  const instance = {
    status: 'running' as const,
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [stage],
    },
    stageRuntimes: [
      {
        stageId: decideId,
        status: 'done',
        outputs: {
          [DECISION_ARTIFACTS_OUTPUT_KEY]: {
            version: 1,
            files: [],
            modules: [{ name: opts.semantic, exports: opts.exports }],
          },
        },
        retryCount: 0,
      },
    ],
    currentStageIndex: 0,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-gate-'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), opts.testBody);
  return {
    phase: 'post-stage',
    stage,
    instance,
    taskWorkspaceAbs: dir,
    executionHost: {
      readPythonModuleContractLintMode: () => opts.mode,
      getWorkspaceRootAbsolute: () => dir,
    } as never,
  };
}

test('module-contract gate off is disabled', () => {
  const ctx = makeGateCtx({
    mode: 'off',
    semantic: 'signals',
    exports: ['run'],
    testBody: 'from signals import compute\n',
  });
  assert.equal(moduleContractGate.enabled?.(ctx), false);
});

test('module-contract gate hard blocks undeclared import', () => {
  const ctx = makeGateCtx({
    mode: 'hard',
    semantic: 'signals',
    exports: ['run'],
    testBody: 'from signals import compute\n',
  });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'block');
  assert.match(result.messages.join(' '), /module-contract/);
});

test('module-contract gate warn passes through as warn severity', () => {
  const ctx = makeGateCtx({
    mode: 'warn',
    semantic: 'signals',
    exports: ['run'],
    testBody: 'from signals import compute\n',
  });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result.severity, 'warn');
});

test('module-contract gate hard blocks from __init__ import (package layout)', () => {
  const ctx = makeGateCtx({
    mode: 'hard',
    semantic: 'indicators',
    exports: ['compute_ma'],
    testBody: 'from __init__ import compute_ma\n',
  });
  const result = evalSync(ctx);
  assert.ok(result);
  assert.equal(result!.severity, 'block');
  assert.match(result!.messages.join(' '), /from indicators import/);
});

test('module-contract gate passes when import matches contract', () => {
  const ctx = makeGateCtx({
    mode: 'hard',
    semantic: 'signals',
    exports: ['compute'],
    testBody: 'from signals import compute\n',
  });
  assert.equal(evalSync(ctx), null);
});
