import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseSseDeltaStream } from '../SseDeltaStream';

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
}

test('parseSseDeltaStream merges deltas across chunked SSE lines', async () => {
  const body = sseBody([
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const parts: string[] = [];
  for await (const d of parseSseDeltaStream(body, new AbortController().signal)) {
    parts.push(d);
  }
  assert.equal(parts.join(''), 'Hello world');
});

test('parseSseDeltaStream ignores non-data lines', async () => {
  const body = sseBody([': ping\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  const parts: string[] = [];
  for await (const d of parseSseDeltaStream(body, new AbortController().signal)) {
    parts.push(d);
  }
  assert.deepEqual(parts, ['ok']);
});

test('parseSseDeltaStream fires onActivity for reasoning-only deltas (no content yielded)', async () => {
  // 推理模型作答前只流式输出 reasoning_content（思维链），content 为空。
  // 期望：不产出任何正文增量，但 onActivity 仍触发——这样引擎的空闲超时
  // 不会在长思考阶段被误判为卡死。
  const body = sseBody([
    'data: {"choices":[{"delta":{"reasoning_content":"让我想想…"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"继续推理…"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  let activity = 0;
  const parts: string[] = [];
  for await (const d of parseSseDeltaStream(body, new AbortController().signal, () => {
    activity += 1;
  })) {
    parts.push(d);
  }
  assert.deepEqual(parts, ['答案']);
  assert.ok(activity >= 3, `onActivity 应在每个流量块触发，实际 ${activity}`);
});

test('parseSseDeltaStream surfaces usage chunk via onUsage', async () => {
  // stream_options.include_usage 下，厂商在末尾 chunk（choices 为空）下发 usage。
  const body = sseBody([
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":34,"total_tokens":154}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const parts: string[] = [];
  const usages: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }[] =
    [];
  for await (const d of parseSseDeltaStream(body, new AbortController().signal, undefined, (u) => {
    usages.push(u);
  })) {
    parts.push(d);
  }
  assert.deepEqual(parts, ['hi']);
  assert.equal(usages.length, 1, 'usage 应被回调一次');
  assert.equal(usages[0].prompt_tokens, 120);
  assert.equal(usages[0].completion_tokens, 34);
  assert.equal(usages[0].total_tokens, 154);
});

test('parseSseDeltaStream fires onActivity on keepalive comment lines', async () => {
  // SSE keepalive（`: ping`）也算连接存活，应重置空闲计时器，即使不含正文。
  const body = sseBody([': ping\n', ': ping\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']);
  let activity = 0;
  const parts: string[] = [];
  for await (const d of parseSseDeltaStream(body, new AbortController().signal, () => {
    activity += 1;
  })) {
    parts.push(d);
  }
  assert.deepEqual(parts, ['ok']);
  assert.ok(activity >= 3, `keepalive 也应触发 onActivity，实际 ${activity}`);
});
