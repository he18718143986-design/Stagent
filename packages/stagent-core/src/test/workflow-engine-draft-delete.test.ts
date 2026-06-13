import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkflowEngine } from '../WorkflowEngine';
import { persistInstanceFile } from '../WorkflowPersistence';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { WorkflowDefinition, WorkflowInstance, WorkflowStatus } from '../WorkflowDefinition';

interface Harness {
  engine: WorkflowEngine;
  sent: unknown[];
  ws: string;
  globalDir: string;
  key: string;
}

function makeWorkflow(ws: string): WorkflowDefinition {
  return {
    id: 'wf1',
    version: '2.0',
    meta: { title: '本地脚本', taskType: 'prototype', userInput: 'x', createdAt: '', taskWorkspacePath: ws },
    stages: [
      {
        id: 'stage_impl_a',
        title: '生成 a.py',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'a.py', writePathBase: 'workspace' },
        input: { sources: [] },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;
}

function setup(status: WorkflowStatus, opts?: { failedStage?: boolean }): Harness {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-eng-'));
  const ws = path.join(base, 'task');
  const globalDir = path.join(base, 'global');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });

  const key = 'inst-1';
  const taskDir = path.join(ws, '.stagent', 'instances', key);
  const wf = makeWorkflow(ws);
  const instance: WorkflowInstance = {
    traceId: 'trace_x',
    definition: wf,
    currentStageIndex: 0,
    stageRuntimes: wf.stages.map((s) => ({
      stageId: s.id,
      status: opts?.failedStage ? 'error' : 'pending',
      outputs: {},
      retryCount: 0,
      ...(opts?.failedStage
        ? { lastError: { error: 'test failure', errorType: 'tool-execution-failed' as const } }
        : {}),
    })),
    status,
    taskDir,
    artifactRegistry: [
      { stageId: 'stage_impl_a', outputKey: 'code', filePath: path.join(ws, 'a.py'), state: 'persisted', checksum: 'c', createdAt: '', existedBefore: false },
      { stageId: 'stage_pre', outputKey: 'code', filePath: path.join(ws, 'keep.py'), state: 'persisted', checksum: 'c', createdAt: '', existedBefore: true },
    ],
  };

  // 落盘产物 + 过程文档 + 实例状态文件，让 loadInstanceByKey 找得到磁盘真源。
  fs.writeFileSync(path.join(ws, 'a.py'), 'print(1)', 'utf8');
  fs.writeFileSync(path.join(ws, 'keep.py'), 'print(2)', 'utf8');
  fs.writeFileSync(path.join(ws, '需求分析文档.md'), '# req', 'utf8');
  fs.writeFileSync(path.join(ws, '工作流规划.md'), '# plan', 'utf8');
  persistInstanceFile(key, instance, ws, globalDir);

  const sent: unknown[] = [];
  const state = new Map<string, unknown>();
  state.set(`wf_instance_${key}`, instance);

  const platform = {
    config: { get: <T>(_k: string, d?: T): T | undefined => d },
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
    llm: { listModels: async () => [] },
  } as unknown as PlatformAdapter;

  return { engine: new WorkflowEngine(platform), sent, ws, globalDir, key };
}

test('deleteInstance(record) 保留产物，仅清记录与状态目录', () => {
  const h = setup('completed');
  h.engine.deleteInstance(h.key, 'record');
  assert.ok(fs.existsSync(path.join(h.ws, 'a.py')));
  assert.ok(fs.existsSync(path.join(h.ws, 'keep.py')));
  assert.ok(!fs.existsSync(path.join(h.ws, '.stagent', 'instances', h.key)));
});

test('deleteInstance(artifacts) 删新建产物与过程文档，保留已存在文件', () => {
  const h = setup('completed');
  h.engine.deleteInstance(h.key, 'artifacts');
  assert.ok(!fs.existsSync(path.join(h.ws, 'a.py')), 'a.py 应被删');
  assert.ok(!fs.existsSync(path.join(h.ws, '需求分析文档.md')), '过程文档应被删');
  assert.ok(!fs.existsSync(path.join(h.ws, '工作流规划.md')), '过程文档应被删');
  assert.ok(fs.existsSync(path.join(h.ws, 'keep.py')), 'existedBefore=true 文件应保留');
});

test('deleteInstance(folder) 递归删除整个工作文件夹', () => {
  const h = setup('completed');
  h.engine.deleteInstance(h.key, 'folder');
  assert.ok(!fs.existsSync(h.ws), '整个工作目录应被删除');
});

test('resumeInstance(idle) 仅回确认页：发 workflowGenerated、不发 stageStatusUpdate', async () => {
  const h = setup('idle');
  const res = await h.engine.resumeInstance(h.key);
  assert.equal(res.ok, true);
  const types = h.sent.map((m) => (m as { type: string }).type);
  assert.equal(types.filter((t) => t === 'workflowGenerated').length, 1);
  assert.ok(!types.includes('stageStatusUpdate'), 'idle 草稿恢复不应重放阶段状态');
  const gen = h.sent.find((m) => (m as { type: string }).type === 'workflowGenerated') as {
    instanceKey?: string;
  };
  assert.equal(gen.instanceKey, h.key);
});

test('resumeInstance(failed) 发 instanceResumed、重放 stageError，不发 workflowGenerated', async () => {
  const h = setup('failed', { failedStage: true });
  const res = await h.engine.resumeInstance(h.key);
  assert.equal(res.ok, true);
  const types = h.sent.map((m) => (m as { type: string }).type);
  assert.ok(!types.includes('workflowGenerated'));
  assert.equal(types.filter((t) => t === 'instanceResumed').length, 1);
  assert.ok(types.includes('stageError'));
  const resumed = h.sent.find((m) => (m as { type: string }).type === 'instanceResumed') as {
    instanceStatus?: string;
    failedStageId?: string;
  };
  assert.equal(resumed.instanceStatus, 'failed');
  assert.equal(resumed.failedStageId, 'stage_impl_a');
});

test('startExecution 复用 failed 实例 key，不新建 UUID', async () => {
  const h = setup('failed', { failedStage: true });
  const wf = makeWorkflow(h.ws);
  await h.engine.startExecution(wf, h.key);
  const keys = Array.from(
    (h.engine as unknown as { platform: PlatformAdapter }).platform.state.keys(),
  ).filter((k) => k.startsWith('wf_instance_'));
  assert.equal(keys.length, 1);
  assert.equal(keys[0], `wf_instance_${h.key}`);
});
