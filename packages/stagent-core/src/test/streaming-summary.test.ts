/**
 * StreamingSummary 纯函数 + WorkflowExecutor skip 集成测试
 * --------------------------------------------------------
 * 对应 M14.3 / SPEC §9.1 I-22。
 *
 * 测试矩阵：
 *   T1  emptyStreamStats 初值正确
 *   T2  appendStreamChunk 单 chunk 计数
 *   T3  appendStreamChunk 多 chunk 累计 + firstChunkAt 不变 + lastChunkAt 更新
 *   T4  appendStreamChunk 空字符串视为 0 字符但仍计 1 个 chunk
 *   T5  buildLlmStreamSummary 透传 meta（retried / channel）
 *   T6  WorkflowExecutor skip 命中调用 logUserAction('stage_skipped') 一次
 *   T7  WorkflowExecutor 不调 skip 时不发 stage_skipped
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendStreamChunk,
  buildLlmStreamSummary,
  emptyStreamStats,
} from '../StreamingSummary';
import { executeNextStageLoop } from '../WorkflowExecutor';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';

test('T1 emptyStreamStats yields zeroed object with no timestamps', () => {
  const stats = emptyStreamStats();
  assert.equal(stats.chars, 0);
  assert.equal(stats.chunkCount, 0);
  assert.equal(stats.firstChunkAt, undefined);
  assert.equal(stats.lastChunkAt, undefined);
});

test('T2 appendStreamChunk single chunk records chars/count/time', () => {
  const now = '2026-05-12T20:00:00.000Z';
  const s = appendStreamChunk(emptyStreamStats(), 'hello', now);
  assert.equal(s.chars, 5);
  assert.equal(s.chunkCount, 1);
  assert.equal(s.firstChunkAt, now);
  assert.equal(s.lastChunkAt, now);
});

test('T3 appendStreamChunk preserves firstChunkAt across multiple chunks', () => {
  const t1 = '2026-05-12T20:00:00.000Z';
  const t2 = '2026-05-12T20:00:01.000Z';
  const t3 = '2026-05-12T20:00:02.500Z';
  let s = appendStreamChunk(emptyStreamStats(), 'abc', t1);
  s = appendStreamChunk(s, 'de', t2);
  s = appendStreamChunk(s, 'f', t3);
  assert.equal(s.chars, 6);
  assert.equal(s.chunkCount, 3);
  assert.equal(s.firstChunkAt, t1, 'firstChunkAt must be sticky');
  assert.equal(s.lastChunkAt, t3, 'lastChunkAt must advance');
});

test('T4 appendStreamChunk handles empty / non-string defensively', () => {
  const now = '2026-05-12T20:00:00.000Z';
  const s1 = appendStreamChunk(emptyStreamStats(), '', now);
  assert.equal(s1.chars, 0);
  assert.equal(s1.chunkCount, 1, '空字符串仍算作一个 chunk');
  assert.equal(s1.firstChunkAt, now);

  const s2 = appendStreamChunk(emptyStreamStats(), undefined as unknown as string, now);
  assert.equal(s2.chars, 0);
  assert.equal(s2.chunkCount, 1, 'undefined 被防御为空字符串，仍计 1 chunk');
});

test('T5 buildLlmStreamSummary forwards meta (retried / channel) verbatim', () => {
  const stats = appendStreamChunk(emptyStreamStats(), 'xy', '2026-05-12T20:00:00.000Z');
  const p1 = buildLlmStreamSummary('stage_x', stats);
  assert.equal(p1.stageId, 'stage_x');
  assert.equal(p1.chars, 2);
  assert.equal(p1.chunkCount, 1);
  assert.equal(p1.retried, undefined);
  assert.equal(p1.channel, undefined);

  const p2 = buildLlmStreamSummary('stage_x', stats, { retried: true, channel: 'http' });
  assert.equal(p2.retried, true);
  assert.equal(p2.channel, 'http');

  const p3 = buildLlmStreamSummary('stage_x', stats, { retried: false, channel: 'lm-api' });
  assert.equal(p3.retried, false);
  assert.equal(p3.channel, 'lm-api');
});

// === 集成：skip 分支必须发 stage_skipped ===

function plainStage(id: string, skipIf?: Stage['skipIf']): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: `run ${id}` },
    input: { sources: [{ type: 'user-input', label: 'x' }], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    skipIf,
  };
}

function makeLinearInstance(stages: Stage[]): WorkflowInstance {
  return {
    definition: {
      id: 'wf_skip_test',
      version: '2.0',
      meta: {
        title: 'skip',
        taskType: 'software',
        userInput: 'x',
        createdAt: new Date().toISOString(),
      },
      stages,
    },
    currentStageIndex: 0,
    stageRuntimes: stages.map((s) => ({
      stageId: s.id,
      status: 'pending',
      outputs: {},
      retryCount: 0,
    })),
    status: 'running',
  };
}

test('T6 skip 命中分支必须调 logUserAction(stage_skipped) 一次（I-22）', async () => {
  const stages = [
    plainStage('stage_a'),
    plainStage('stage_b', { type: 'exitCodeZero', stageId: 'stage_a' }),
    plainStage('stage_c'),
  ];
  const instance = makeLinearInstance(stages);
  const userActions: Array<{ kind: string; detail: Record<string, unknown> }> = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: (cond) => {
      // 仅当判定 stage_b 的 skipIf 时返回 true（模拟引擎判定器，规避对真正实现的耦合）
      return cond.type === 'exitCodeZero' && cond.stageId === 'stage_a';
    },
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => `ok:${stageId}`,
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    logUserAction: (kind, detail) => {
      userActions.push({ kind, detail });
    },
  });

  const skipped = userActions.filter((a) => a.kind === 'stage_skipped');
  assert.equal(skipped.length, 1, '正好一次 stage_skipped');
  assert.equal(skipped[0].detail.stageId, 'stage_b');
  assert.ok(skipped[0].detail.condition, 'detail 中携带触发的 skipIf 条件');
  // stage_b 必须真的被标 skipped 状态
  const rtB = instance.stageRuntimes.find((rt) => rt.stageId === 'stage_b');
  assert.equal(rtB?.status, 'skipped');
});

test('T7 无 skipIf 命中时不发 stage_skipped', async () => {
  const stages = [plainStage('stage_a'), plainStage('stage_b')];
  const instance = makeLinearInstance(stages);
  const userActions: Array<{ kind: string }> = [];

  await executeNextStageLoop({
    instance,
    panel: {},
    currentInstanceKey: undefined,
    setCurrentInstanceKey: () => {},
    evaluateSkipCondition: () => false,
    postMessage: () => {},
    scheduleSave: () => {},
    warn: () => {},
    debugLog: () => {},
    primaryOutputKey: (s) => s.outputs[0].key,
    ensureTaskDir: () => {},
    resolveInput: async () => '',
    executeLlmText: async (stageId) => `ok:${stageId}`,
    applyPatchInstructions: async () => {},
    resolveTaskFilePath: (_i, p) => p,
    resolveOutputPath: (_i, p) => p,
    runCodeRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    isCancellationError: () => false,
    logUserAction: (kind) => userActions.push({ kind }),
  });

  assert.equal(
    userActions.filter((a) => a.kind === 'stage_skipped').length,
    0,
    '未命中 skipIf 不应发 stage_skipped',
  );
  assert.equal(instance.status, 'completed');
});
