import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowEngine } from '../WorkflowEngine';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { WorkflowDefinition } from '../WorkflowDefinition';

function minimalRefactorWorkflow(userInput: string, ws: string): WorkflowDefinition {
  return {
    id: 'wf_refactor_min',
    version: '2.0',
    meta: {
      title: '最小重构',
      taskType: 'refactor',
      userInput,
      createdAt: new Date().toISOString(),
      taskWorkspacePath: ws,
    },
    stages: [
      {
        id: 'stage_refactor_plan',
        title: '重构计划',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '输出重构计划' },
        input: { sources: [{ type: 'user-input', label: '目标' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'plan', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;
}

/** 含 stage_test_run 但 tool 非 code-runner：Rule20 violation → blocked 确认页。 */
function blockedRule20Workflow(userInput: string, ws: string): WorkflowDefinition {
  return {
    id: 'wf_blocked_rule20',
    version: '2.0',
    meta: {
      title: 'Rule20 阻断',
      taskType: 'refactor',
      userInput,
      createdAt: new Date().toISOString(),
      taskWorkspacePath: ws,
    },
    stages: [
      {
        id: 'stage_test_run_integration',
        title: '集成测试',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: '口述测试结果' },
        input: { sources: [{ type: 'user-input', label: '目标' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'report', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;
}

interface HarnessOpts {
  llmResponse: string;
  configOverrides?: Record<string, unknown>;
}

function setupHarness(opts: HarnessOpts): {
  engine: WorkflowEngine;
  sent: unknown[];
  ws: string;
  globalDir: string;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-unified-log-'));
  const ws = path.join(base, 'task');
  const globalDir = path.join(base, 'global');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });

  const sent: unknown[] = [];
  const state = new Map<string, unknown>();

  const platform = {
    config: {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        if (key === 'plan.requireCompleteness') {
          return false as T;
        }
        if (key === 'codebaseContextEnabled') {
          return false as T;
        }
        if (key === 'experienceInjectOnGenerate') {
          return false as T;
        }
        if (key === 'promptVersionsEnabled') {
          return false as T;
        }
        if (key === 'staticAnalysisEnabled') {
          return false as T;
        }
        if (key === 'llmApiKey') {
          return 'test-key' as T;
        }
        if (opts.configOverrides && key in opts.configOverrides) {
          return opts.configOverrides[key] as T;
        }
        return defaultValue;
      },
    },
    state: {
      get: <T>(k: string): T | undefined => state.get(k) as T | undefined,
      set: <T>(k: string, v: T | undefined): void => {
        if (v === undefined) {
          state.delete(k);
        } else {
          state.set(k, v);
        }
      },
      keys: (): readonly string[] => Array.from(state.keys()),
    },
    paths: { globalStorageDir: (): string => globalDir, workspaceRoot: (): string | undefined => ws },
    ui: { send: (m: unknown): void => void sent.push(m), onMessage: () => ({ dispose(): void {} }) },
    notify: {
      info: async (): Promise<undefined> => undefined,
      warn: async (): Promise<undefined> => undefined,
      error: async (): Promise<undefined> => undefined,
    },
    dialog: { pickDirectory: async (): Promise<undefined> => undefined },
    editor: { openFile: async (): Promise<void> => {}, openDiff: async (): Promise<void> => {} },
    shell: { openExternal: async (): Promise<void> => {}, copyText: async (): Promise<void> => {} },
    llm: {
      listModels: async () => [
        {
          id: 'test',
          family: 'direct:test',
          name: 'Test',
          structuredOutput: true,
          sendRequest: async function* () {
            yield opts.llmResponse;
          },
        },
      ],
    },
  } as unknown as PlatformAdapter;

  const engine = new WorkflowEngine(platform);
  engine.setPreferredModelFamily('direct:test');
  return { engine, sent, ws, globalDir };
}

function readDebugLog(taskDir: string): string {
  const p = path.join(taskDir, '.wf-debug.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function findInstanceKey(sent: unknown[]): string | undefined {
  const polished = sent.find((m) => (m as { type?: string }).type === 'userTaskPolished') as
    | { instanceKey?: string }
    | undefined;
  if (polished?.instanceKey) {
    return polished.instanceKey;
  }
  const gen = sent.find((m) => (m as { type?: string }).type === 'workflowGenerated') as
    | { instanceKey?: string }
    | undefined;
  return gen?.instanceKey;
}

test('polishUserTask with workspace creates shell and logs llm events to .wf-debug.log', async () => {
  const h = setupHarness({ llmResponse: '润色后的任务描述' });
  await h.engine.polishUserTask('原始草稿', 'refactor', h.ws);

  const key = findInstanceKey(h.sent);
  assert.ok(key, '应返回 instanceKey');
  const taskDir = path.join(h.ws, '.stagent', 'instances', key!);
  assert.ok(fs.existsSync(taskDir), 'taskDir 应存在');
  const log = readDebugLog(taskDir);
  assert.match(log, /pre_exec_shell_created/);
  assert.match(log, /\[task-polish\] \[llm_start\]/);
  assert.match(log, /\[task-polish\] \[llm_end\]/);
  assert.doesNotMatch(log, /\[session\]/);
});

test('generateWorkflow reuses polish shell key and appends codebase_snapshot', async () => {
  const wf = minimalRefactorWorkflow('任务', '');
  const h = setupHarness({ llmResponse: JSON.stringify(wf) });
  await h.engine.polishUserTask('任务', 'refactor', h.ws);
  const polishKey = findInstanceKey(h.sent);
  assert.ok(polishKey);

  h.sent.length = 0;
  await h.engine.generateWorkflow('任务', 'refactor', h.ws);

  const gen = h.sent.find((m) => (m as { type?: string }).type === 'workflowGenerated') as {
    instanceKey?: string;
  };
  assert.ok(gen);
  assert.equal(gen.instanceKey, polishKey, 'generate 应复用润色壳的 instanceKey');
  const taskDir = path.join(h.ws, '.stagent', 'instances', polishKey!);
  const log = readDebugLog(taskDir);
  assert.match(log, /codebase_snapshot/);
  const keys = Array.from(
    (h.engine as unknown as { platform: PlatformAdapter }).platform.state.keys(),
  ).filter((k) => k.startsWith('wf_instance_'));
  assert.equal(keys.length, 1, '不应新建第二个实例');
});

test('blocked generate persists idle draft with instanceKey', async () => {
  const wf = blockedRule20Workflow('bad test stage', '');
  const h = setupHarness({
    llmResponse: JSON.stringify(wf),
    configOverrides: { enableRuntimeRule20Verify: true },
  });
  await h.engine.generateWorkflow('bad test stage', 'refactor', h.ws);

  const gen = h.sent.find((m) => (m as { type?: string }).type === 'workflowGenerated') as {
    blocked?: boolean;
    instanceKey?: string;
  };
  assert.ok(gen?.blocked);
  assert.ok(gen.instanceKey, 'blocked 确认页应带 instanceKey');
  const statePath = path.join(h.ws, '.stagent', 'instances', gen.instanceKey!, '.wf-state.json');
  assert.ok(fs.existsSync(statePath));
  const inst = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { status?: string };
  assert.equal(inst.status, 'idle');
});

test('polish without workspace then generate rebinds taskDir under workspace', async () => {
  const wf = minimalRefactorWorkflow('任务', '');
  const h = setupHarness({ llmResponse: JSON.stringify(wf) });
  await h.engine.polishUserTask('任务', 'refactor');
  const polishKey = findInstanceKey(h.sent);
  assert.ok(polishKey);

  const globalTaskDir = path.join(h.globalDir, 'instances', polishKey!);
  assert.ok(fs.existsSync(globalTaskDir), '润色无工作区时壳在 globalStorage');
  assert.match(readDebugLog(globalTaskDir), /pre_exec_shell_created/);

  h.sent.length = 0;
  await h.engine.generateWorkflow('任务', 'refactor', h.ws);

  const wsTaskDir = path.join(h.ws, '.stagent', 'instances', polishKey!);
  assert.ok(fs.existsSync(wsTaskDir), 'generate 后 taskDir 应在工作区下');
  const log = readDebugLog(wsTaskDir);
  assert.match(log, /task_dir_rebound/);
  assert.match(log, /pre_exec_shell_created/);
  assert.match(log, /codebase_snapshot/);
});

test('generateWorkflow failure writes gen_failed to instance debug log', async () => {
  const h = setupHarness({ llmResponse: '<<<not json>>>' });
  await h.engine.generateWorkflow('任务', 'refactor', h.ws);

  const failed = h.sent.find((m) => (m as { type?: string }).type === 'workflowFailed');
  assert.ok(failed);
  const key = h.engine.getActiveInstanceKey();
  assert.ok(key);
  const taskDir = path.join(h.ws, '.stagent', 'instances', key!);
  assert.match(readDebugLog(taskDir), /gen_failed/);
});
