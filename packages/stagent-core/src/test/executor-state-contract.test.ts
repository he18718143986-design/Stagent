
import { test, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BackendMessage, Stage, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import {
  EXECUTOR_INSTANCE_FAIL_REASONS,
  EXECUTOR_HITL_BLOCKING_STAGE_STATUSES,
  EXECUTOR_STAGE_TERMINAL_STATUSES,
} from '../executor-loop/ExecutorStateContract';
import { runDagParallelWave } from '../executor-loop/dag/runWave';
import {
  resetSandboxSoftConstraintAckForTest,
  runCodeRunnerCommand,
} from '../WorkflowCodeRunnerHost';
import { resolveSandboxCapability } from '../sandbox/SandboxCapabilityMatrix';
import { runWorkflowGeneration } from '../WorkflowGenerationRunner';
import { handleRetry } from '../hitl/HitlRetry';
import type { HitlCoordinatorHost } from '../hitl/HitlCoordinatorHost';
import * as transitions from '../WorkflowStateTransitions';
import { StagentError } from '../ErrorTypeUtils';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';

test('ExecutorStateContract exports documented terminal and HITL-blocking sets', () => {
  assert.ok(EXECUTOR_STAGE_TERMINAL_STATUSES.has('done'));
  assert.ok(EXECUTOR_HITL_BLOCKING_STAGE_STATUSES.has('paused'));
  assert.ok(EXECUTOR_HITL_BLOCKING_STAGE_STATUSES.has('waiting-questions'));
  assert.equal(EXECUTOR_INSTANCE_FAIL_REASONS.I9_CASCADE_RESET, 'hitl-retry-i9-cascade-reset-failed');
});

test('runDagParallelWave exits on wave stage failure', async () => {
  const stages: Stage[] = [
    {
      id: 'stage_a',
      title: 'a',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'x' },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'out', format: 'text' }],
      pauseAfter: false,
    },
  ];
  const instance: WorkflowInstance = {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' },
      stages,
    },
    currentStageIndex: 0,
    stageRuntimes: [{ stageId: 'stage_a', status: 'pending', outputs: {}, retryCount: 0 }],
    status: 'running',
  };
  const stageStep = await import('../stage-runners/executeStageStep');
  const restore = mock.method(stageStep, 'executeStageStep', async () => 'failed' as const);
  try {
    const params: ExecuteNextStageLoopParams = {
      instance,
      panel: {} as never,
      currentInstanceKey: 'k',
      setCurrentInstanceKey: () => {},
      evaluateSkipCondition: () => false,
      postMessage: () => {},
      scheduleSave: () => {},
      warn: () => {},
      debugLog: () => {},
      primaryOutputKey: (s) => s.outputs[0]?.key ?? 'out',
      ensureTaskDir: () => '/tmp',
      resolveInput: async () => '',
      executeLlmText: async () => 'ok',
      applyPatchInstructions: async () => {},
      resolveTaskFilePath: () => '/tmp/f',
      resolveOutputPath: () => '/tmp/out',
      runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      isCancellationError: () => false,
    };
    const outcome = await runDagParallelWave(params, [0], 1);
    assert.equal(outcome, 'exit');
  } finally {
    restore.mock.restore();
  }
});

test('runCodeRunnerCommand declines soft constraint when sandbox enabled without enforcement and no confirm', {
  skip: process.platform === 'darwin',
}, async () => {
  resetSandboxSoftConstraintAckForTest();
  const dir = os.tmpdir();
  await assert.rejects(
    () =>
      runCodeRunnerCommand(
        {
          ensureTaskDir: () => dir,
          getWorkspaceRootAbsolute: () => undefined,
          safeJoinUnderWorkspaceRoot: (_r, rel) => path.join(dir, rel),
          resolveTaskFilePath: (_k, rel) => path.join(dir, rel),
          postStreamChunk: () => {},
          warn: () => {},
          sandboxEnabled: true,
          sandboxVerificationOnly: false,
        },
        { type: 'code-runner', command: 'echo hi', captureOutput: true },
        'inst',
        'stage_run',
      ),
    (e: unknown) => e instanceof StagentError && e.errorType === 'tool-execution-failed',
  );
});

test('runCodeRunnerCommand runs with soft constraint after user confirms', {
  skip: process.platform === 'darwin' || resolveSandboxCapability().sandboxEnforced,
}, async () => {
  resetSandboxSoftConstraintAckForTest();
  const dir = os.tmpdir();
  const result = await runCodeRunnerCommand(
    {
      ensureTaskDir: () => dir,
      getWorkspaceRootAbsolute: () => undefined,
      safeJoinUnderWorkspaceRoot: (_r, rel) => path.join(dir, rel),
      resolveTaskFilePath: (_k, rel) => path.join(dir, rel),
      postStreamChunk: () => {},
      warn: () => {},
      sandboxEnabled: true,
      sandboxVerificationOnly: false,
      confirmSoftConstraintSandbox: async () => true,
    },
    { type: 'code-runner', command: 'echo hi', captureOutput: true },
    'inst',
    'stage_run',
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hi/);
});

test('runWorkflowGeneration swallows errors when generation is superseded', async () => {
  const posted: BackendMessage[] = [];
  const degraded: string[] = [];
  const host = {
    bindPanel: () => {},
    postMessage: (_p: unknown, msg: BackendMessage) => posted.push(msg),
    postGenerationProgress: () => {},
    resolveExistingDirectoryPath: () => ({ ok: true as const, abs: '/tmp' }),
    ensurePreExecDraftShell: () => 'shell',
    finalizeDraftDefinition: () => 'draft',
    debugLog: () => {},
    warn: () => {},
    degraded: (reason: string) => degraded.push(reason),
    invokeLlmRaw: async () => {
      throw new Error('llm-boom');
    },
    parseWorkflowJson: async () => {
      throw new Error('never');
    },
    normalizeWorkflow: (wf: WorkflowDefinition) => wf,
    isGenerationSuperseded: () => true,
    isRuntimeRule20VerifyEnabled: () => false,
    readGenerationGates: () => ({
      toIssuesHorizontalLayeringFail: false,
      debugFeedbackLoopMode: 'off' as const,
      planCompletenessEnabled: false,
      planStructuralRepairMode: 'off' as const,
      staticAnalysisEnabled: false,
      contractPlanPreflightV2: false,
    }),
    getMaxStageWarn: () => 45,
  };
  await runWorkflowGeneration(host, {
    myGen: 1,
    userInput: 'build app',
    taskType: 'software',
    panel: {} as never,
    taskWorkspacePathRaw: '/tmp',
    readCodebaseContextEnabled: false,
    readCodebaseContextMaxTokens: 0,
    readPromptVersionsEnabled: false,
    readExperienceInjectOnGenerate: false,
    readGlossaryEnabled: false,
  });
  assert.equal(posted.filter((m) => m.type === 'workflowFailed').length, 0);
  assert.ok(degraded.some((d) => d.includes('generation_superseded_swallow')));
});

test('handleRetry I-9 violation fails instance and posts stageError', async () => {
  const decisionStage: Stage = {
    id: 'stage_decision',
    title: 'd',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: true,
    isDecisionStage: true,
  };
  const downstreamStage: Stage = {
    id: 'stage_impl',
    title: 'i',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: {
      sources: [{ type: 'stage-output', stageId: 'stage_decision', outputKey: PRIMARY_DECISION_OUTPUT_KEY }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
  const instance: WorkflowInstance = {
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' },
      stages: [decisionStage, downstreamStage],
    },
    currentStageIndex: 0,
    stageRuntimes: [
      {
        stageId: 'stage_decision',
        status: 'done',
        outputs: { [PRIMARY_DECISION_OUTPUT_KEY]: 'old' },
        retryCount: 0,
        approvedDecisionRecord: 'old',
      },
      { stageId: 'stage_impl', status: 'done', outputs: { out: 'x' }, retryCount: 0 },
    ],
    status: 'running',
  };
  const messages: BackendMessage[] = [];
  const host: HitlCoordinatorHost = {
    bindPanel: () => {},
    getInstance: () => instance,
    postMessage: (_p, msg) => messages.push(msg),
    logUserAction: () => {},
    markStageArtifactsApproved: () => {},
    scheduleSave: () => {},
    persistMilestone: () => {},
    debugLog: () => {},
    warn: () => {},
    error: () => {},
    executeNextStage: async () => {},
    rejectApproveDecision: () => {},
    ensureInstanceBound: () => true,
    bumpCurrentStageIndex: () => {},
    setCurrentStageIndex: (i) => {
      instance.currentStageIndex = i;
    },
    setInstanceStatus: (s) => {
      instance.status = s;
    },
    getWorkspaceRootAbsolute: () => '/tmp',
    getMaxManualStageRetries: () => 5,
    isDecisionContentLintVscodeDefault: () => false,
    isContractCommitmentsEnabled: () => false,
  };

  const restore = mock.method(transitions, 'collectDecisionRetryResets', () => ({
    resetStageIds: ['stage_impl'],
    resetStageTitles: ['i'],
  }));
  try {
    await handleRetry(host, 'stage_decision', 'retry', {} as never);
    assert.equal(instance.status, 'failed');
    assert.ok(messages.some((m) => m.type === 'stageError'));
    assert.equal(
      messages.filter((m) => m.type === 'downstreamReset').length,
      0,
      'I-9 failure must not emit downstreamReset',
    );
  } finally {
    restore.mock.restore();
  }
});
