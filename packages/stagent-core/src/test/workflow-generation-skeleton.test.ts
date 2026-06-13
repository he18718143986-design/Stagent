import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { BackendMessage, WorkflowDefinition } from '../WorkflowDefinition';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';
import { runWorkflowGeneration } from '../WorkflowGenerationRunner';
import { resolveSkeletonCompilerGate } from '../plan-skeleton/generateWorkflowFromSkeleton';
import { buildGenerationContext } from '../WorkflowGenerationContext';
import { T4_REQUIREMENT_SNIPPET } from './fixtures/t4RequirementSnippet';
import { expandGreenfieldPythonSkeleton } from '../plan-skeleton/expandGreenfieldPythonSkeleton';
import { GREENFIELD_PYTHON_SKELETON_VERSION, SKELETON_PROMPT_PLACEHOLDER_PREFIX } from '../plan-skeleton/constants';
import { normalizeWorkflow } from '../WorkflowGeneration';
import { verifyRule20 } from '../Rule20Verify';

function bindSkeletonCompilerConfig(enabled: boolean): void {
  bindStagentConfigPort({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      if (key === 'contract.skeletonCompiler') {
        return enabled as T;
      }
      return defaultValue;
    },
  });
}

function makeGenerationHost(ws: string, posted: BackendMessage[]) {
  let llmCalls = 0;
  const host = {
    bindPanel: () => {},
    postMessage: (_p: unknown, msg: BackendMessage) => posted.push(msg),
    postGenerationProgress: () => {},
    resolveExistingDirectoryPath: () => ({ ok: true as const, abs: ws }),
    ensurePreExecDraftShell: () => 'shell',
    finalizeDraftDefinition: () => 'draft',
    debugLog: () => {},
    warn: () => {},
    degraded: () => {},
    invokeLlmRaw: async () => {
      llmCalls += 1;
      const { workflow: skel } = expandGreenfieldPythonSkeleton({
        userInput: T4_REQUIREMENT_SNIPPET,
        taskType: 'software',
      });
      const stagePrompts: Record<string, string> = {};
      for (const s of skel.stages ?? []) {
        if (s.tool !== 'llm-text' || s.toolConfig.type !== 'llm-text') continue;
        stagePrompts[s.id] = `语义填充 · ${s.title}`;
      }
      return JSON.stringify({ stagePrompts, globalModules: [] });
    },
    parseWorkflowJson: async () => {
      throw new Error('parseWorkflowJson must not be called on skeleton path');
    },
    normalizeWorkflow: (wf: WorkflowDefinition, userInput: string, taskType: string) =>
      normalizeWorkflow(wf, userInput, taskType),
    isGenerationSuperseded: () => false,
    isRuntimeRule20VerifyEnabled: () => true,
    readGenerationGates: () => ({
      toIssuesHorizontalLayeringFail: false,
      debugFeedbackLoopMode: 'off' as const,
      planCompletenessEnabled: false,
      planStructuralRepairMode: 'off' as const,
      staticAnalysisEnabled: false,
      contractPlanPreflightV2: false,
    }),
    getMaxStageWarn: () => 80,
    getLlmCallCount: () => llmCalls,
  };
  return host;
}

test('resolveSkeletonCompilerGate is true for T4 snippet when contract.skeletonCompiler enabled', async () => {
  bindSkeletonCompilerConfig(true);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-skel-gate-'));
  const ws = path.join(base, 'task');
  fs.mkdirSync(ws, { recursive: true });

  const host = makeGenerationHost(ws, []);
  const params = {
    myGen: 1,
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    panel: {} as never,
    taskWorkspacePathRaw: ws,
    readCodebaseContextEnabled: false,
    readCodebaseContextMaxTokens: 0,
    readPromptVersionsEnabled: false,
    readExperienceInjectOnGenerate: false,
    readGlossaryEnabled: false,
  };
  const ctx = await buildGenerationContext(host, params);
  assert.ok(ctx);
  assert.equal(ctx.pathRouter.workflowTemplate, 'greenfield_full');
  assert.equal(resolveSkeletonCompilerGate(ctx, params), true);
});

test('runWorkflowGeneration skeleton path emits workflowGenerated with one semantic-fill LLM call', async () => {
  bindSkeletonCompilerConfig(true);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-skel-gen-'));
  const ws = path.join(base, 'task');
  fs.mkdirSync(ws, { recursive: true });

  const posted: BackendMessage[] = [];
  const host = makeGenerationHost(ws, posted);

  await runWorkflowGeneration(host, {
    myGen: 1,
    userInput: T4_REQUIREMENT_SNIPPET,
    taskType: 'software',
    panel: {} as never,
    taskWorkspacePathRaw: ws,
    readCodebaseContextEnabled: false,
    readCodebaseContextMaxTokens: 0,
    readPromptVersionsEnabled: false,
    readExperienceInjectOnGenerate: false,
    readGlossaryEnabled: false,
  });

  assert.equal(host.getLlmCallCount(), 1);
  const generated = posted.filter((m) => m.type === 'workflowGenerated');
  assert.equal(generated.length, 1, `expected workflowGenerated, got: ${posted.map((m) => m.type).join(',')}`);
  const msg = generated[0] as {
    workflow: WorkflowDefinition;
    blocked?: boolean;
    blockReasons?: string[];
  };
  assert.notEqual(msg.blocked, true, msg.blockReasons?.join('; '));
  const wf = msg.workflow;
  assert.equal(wf.meta?.skeletonVersion, GREENFIELD_PYTHON_SKELETON_VERSION);
  assert.ok(wf.stages.some((s) => s.id === 'stage_decide_architecture_overview'));
  assert.ok(wf.stages.some((s) => s.id === 'stage_write_config'));
  const llmStages = wf.stages.filter((s) => s.tool === 'llm-text');
  assert.ok(llmStages.length > 0);
  for (const s of llmStages) {
    if (s.toolConfig.type !== 'llm-text') continue;
    assert.equal(s.toolConfig.systemPrompt?.includes(SKELETON_PROMPT_PLACEHOLDER_PREFIX), false);
  }
  const rule20 = verifyRule20(wf);
  assert.equal(rule20.passed, true, rule20.violations.map((v) => v.message).join('; '));
});
