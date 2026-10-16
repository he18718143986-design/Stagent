/**
 * Claude Code 适配器的 SDK 合同（§8 spike 结论）：用替身 query() 验证我们传给 SDK 的选项与对返回消息的解析。
 */
import { describe, expect, it } from 'vitest';
import { AgentRunError, ClaudeCodeExecutor } from '../../src/agent/claude-code.js';

type Msg = Record<string, unknown>;

function fakeQuery(messages: Msg[]) {
  const calls: { prompt: string; options: Record<string, unknown> }[] = [];
  const fn = (params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  };
  return { fn, calls };
}

const result = (text: string, extra: Msg = {}): Msg => ({
  type: 'result',
  subtype: 'success',
  result: text,
  session_id: 's-1',
  total_cost_usd: 0.42,
  usage: { input_tokens: 1200, output_tokens: 340 },
  modelUsage: { 'claude-sonnet-5': {} },
  ...extra,
});

describe('ClaudeCodeExecutor（SDK 合同）', () => {
  it('实现任务：cwd、settingSources=project（守卫 hook 生效）、acceptEdits；解析回报、会话 id 与用量', async () => {
    const q = fakeQuery([
      { type: 'system', subtype: 'init', session_id: 's-1' },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.js' } }] } },
      result('## 改了什么\n改了 a\n\n## 取舍\n无\n\n## 例子\n- e-1: 已实现\n'),
    ]);
    const sessions: string[] = [];
    const lines: string[] = [];
    const ex = new ClaudeCodeExecutor({ queryFn: q.fn });
    const out = await ex.implement(
      { changeId: 'c', description: '改按钮', examples: [{ exampleId: 'e-1', featureName: 'f', given: 'g', when: 'w', then: 't', checkPath: '.stagent/checks/x' }], rules: [], knownFiles: [] },
      { projectRoot: '/proj', onSession: (s) => sessions.push(s), onProgress: (p) => lines.push(p.line), maxBudgetUsd: 3 },
    );
    expect(q.calls[0]!.options).toMatchObject({ cwd: '/proj', settingSources: ['project'], permissionMode: 'acceptEdits', maxBudgetUsd: 3 });
    expect(q.calls[0]!.prompt).toContain('不要修改 .stagent/');
    expect(sessions).toEqual(['s-1']);
    expect(lines).toContain('Edit src/a.js');
    expect(out.value).toMatchObject({ changed: '改了 a', claimedExampleIds: ['e-1'], malformed: false });
    expect(out.usage).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1200, outputTokens: 340, estimatedCost: 0.42 });
  });

  it('只读任务（分类）：dontAsk + 只读工具；续接会话时传 resume', async () => {
    const q = fakeQuery([result('```json\n{"track":"feature","targetFeatureIds":["f-1","nope"],"suggestPlan":true,"rationale":"会改登录和注册"}\n```')]);
    const ex = new ClaudeCodeExecutor({ queryFn: q.fn });
    const out = await ex.classifyChange(
      { description: '加会员', features: [{ featureId: 'f-1', name: '登录', stateLabel: '已验证', examples: [], files: [] }], systemMap: '' },
      { projectRoot: '/p', resume: 'old-session' },
    );
    expect(q.calls[0]!.options).toMatchObject({ permissionMode: 'dontAsk', allowedTools: ['Read', 'Grep', 'Glob', 'LS'], resume: 'old-session' });
    expect(out.value).toEqual({ track: 'feature', targetFeatureIds: ['f-1'], suggestPlan: true, rationale: '会改登录和注册' });
  });

  it('起草例子：不给 Bash；只接受写在草稿目录里的检查', async () => {
    const q = fakeQuery([
      result(
        '```json\n{"examples":[{"given":"g","when":"w","then":"t","kind":"behavior","checkPath":".stagent/checks/draft/c1/a.spec.ts","summary":"看 a"},{"given":"g","when":"w","then":"t2","checkPath":"src/evil.ts","summary":"越界"}]}\n```',
      ),
    ]);
    const ex = new ClaudeCodeExecutor({ queryFn: q.fn });
    const out = await ex.draftExamples(
      { mode: 'new', requirement: 'r', featureName: 'f', features: [], draftDir: '.stagent/checks/draft/c1', checkCommand: 'node {path}' },
      { projectRoot: '/p' },
    );
    expect(q.calls[0]!.options).toMatchObject({ permissionMode: 'acceptEdits', disallowedTools: ['Bash'] });
    expect(out.value.map((e) => e.checkPath)).toEqual(['.stagent/checks/draft/c1/a.spec.ts']);
  });

  it('达到 maxBudgetUsd：抛 AgentRunError(budgetExceeded)，用量照样带回', async () => {
    const q = fakeQuery([result('', { subtype: 'error_max_budget_usd', errors: [], is_error: true })]);
    const ex = new ClaudeCodeExecutor({ queryFn: q.fn });
    const err = await ex.answerDecisionQuestion({ card: { question: 'q', background: '', options: [] }, question: '?' }, { projectRoot: '/p' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentRunError);
    expect((err as AgentRunError).budgetExceeded).toBe(true);
    expect((err as AgentRunError).usage?.estimatedCost).toBe(0.42);
  });

  it('扫描：每输出一行 FEATURE 就回调一次（流式返回功能清单）', async () => {
    const q = fakeQuery([
      { type: 'assistant', session_id: 's', message: { content: [{ type: 'text', text: 'FEATURE {"name":"登录","description":"d","entryFiles":["app/login/page.tsx"]}\n' }] } },
      { type: 'assistant', session_id: 's', message: { content: [{ type: 'text', text: 'FEATURE {"name":"购物车","entryFiles":["app/cart/page.tsx"]}\nDONE' }] } },
      result('DONE'),
    ]);
    const seen: string[] = [];
    const out = await new ClaudeCodeExecutor({ queryFn: q.fn }).scanFeatures({ stackHint: 'next' }, { projectRoot: '/p', onFeature: (f) => seen.push(f.name) });
    expect(seen).toEqual(['登录', '购物车']);
    expect(out.value[0]).toMatchObject({ name: '登录', entryFiles: ['app/login/page.tsx'] });
  });

  it('STAGENT_AGENT=off 时不可用并给出原因', async () => {
    const a = await new ClaudeCodeExecutor().availability();
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/关闭/);
  });
});
