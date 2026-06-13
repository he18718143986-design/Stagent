/**
 * P2（T4 Run #26 根治）：post impl gate block → 同 stage 重试信号语义。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BackendMessage, Stage, WorkflowInstance } from '../WorkflowDefinition';
import { registerBuiltinQualityGates } from '../BuiltinQualityGates';
import { resetDefaultQualityGateRegistry } from '../QualityGate';
import { scoreLlmTextConfidenceAndGates } from '../stage-runners/LlmTextScoreStep';
import { StageAlreadyHandledError } from '../stage-runners/StageControlSignals';
import {
  MAX_MUTATE_GATE_RETRIES,
  MutateGateBlockedError,
  readMutateGateRetryState,
} from '../stage-runners/llm-persist/mutateGateRetry';
import { implStageIdFromSemanticName } from '../workflow/StageIdPatterns';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { StageStepContext } from '../stage-runners/StageStepContext';

const EXTRA_EXPORT_IMPL = `import argparse

class DataPipeline:
    pass

def run():
    return 0

def main():
    return run()

def load_config(path):
    return {}

def create_pipeline(cfg):
    return DataPipeline()
`;

function makeCtx(opts: { mode: 'warn' | 'hard'; implBody: string }): StageStepContext {
  const semantic = 'main';
  const implPath = 'main.py';
  const stage: Stage = {
    id: implStageIdFromSemanticName(semantic)!,
    title: 'impl',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'impl',
      writeOutputToFile: implPath,
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
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
        stageId: 'stage_decide_main',
        status: 'done',
        outputs: {
          [DECISION_ARTIFACTS_OUTPUT_KEY]: {
            version: 1,
            files: [],
            modules: [{ name: 'main', exports: ['run', 'main', 'load_config', 'create_pipeline'] }],
          },
        },
        retryCount: 0,
      },
      { stageId: stage.id, status: 'running', outputs: { code: opts.implBody }, retryCount: 0 },
    ],
    currentStageIndex: 1,
  } satisfies WorkflowInstance;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-gate-retry-'));
  fs.writeFileSync(path.join(dir, implPath), opts.implBody);

  const host = {
    getWorkspaceRootAbsolute: () => dir,
    readTestQualityLintMode: () => 'off' as const,
    readPythonModuleContractLintMode: () => opts.mode,
    readPythonPypiSymbolLintMode: () => 'off' as const,
  };
  const params = {
    panel: {},
    instance,
    postMessage: (_p: unknown, _msg: BackendMessage) => {},
    debugLog: () => {},
    primaryOutputKey: (s: Stage) => s.outputs[0]?.key ?? 'code',
    confidencePauseThreshold: 0,
    scheduleSave: () => {},
    getWorkspaceRoot: () => dir,
    memoryExperienceEnabled: false,
    qualityGateExecutionHost: host,
  } as never;
  return {
    params,
    stageIndex: 1,
    instance,
    stage,
    runtime: instance.stageRuntimes[1]!,
    panel: {},
  };
}

function withBuiltinGates(fn: () => Promise<void>): Promise<void> {
  resetDefaultQualityGateRegistry();
  registerBuiltinQualityGates();
  return fn().finally(() => resetDefaultQualityGateRegistry());
}

test('hard module-contract export-extra → 前 MAX 次抛 MutateGateBlockedError', () =>
  withBuiltinGates(async () => {
    const ctx = makeCtx({ mode: 'hard', implBody: EXTRA_EXPORT_IMPL });
    for (let i = 1; i <= MAX_MUTATE_GATE_RETRIES; i++) {
      await assert.rejects(
        scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {}),
        (e: unknown) => e instanceof MutateGateBlockedError,
      );
      assert.equal(readMutateGateRetryState(ctx.runtime.outputs).attempts, i);
    }
    await assert.rejects(
      scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {}),
      (e: unknown) => e instanceof StageAlreadyHandledError,
    );
    assert.equal(ctx.instance.status, 'failed');
  }));

test('warn 模式 export-extra 不抛 MutateGateBlockedError', () =>
  withBuiltinGates(async () => {
    const ctx = makeCtx({ mode: 'warn', implBody: EXTRA_EXPORT_IMPL });
    await scoreLlmTextConfidenceAndGates(ctx, 1, 'ikey', {});
    assert.equal(readMutateGateRetryState(ctx.runtime.outputs).attempts, 0);
  }));
