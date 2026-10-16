/**
 * SDK 合同 spike（规格 §8，tasks.md「SDK 调研」）：用类型检查把我们依赖的 Agent SDK 合同固定下来。
 * 运行 `npx tsc --noEmit -p spikes/agent-sdk` —— SDK 升级后任何一项合同变了，这里就编译失败。
 * 真实调用验证脚本见 live.mjs（需要登录的 Claude Code，会产生少量费用，CI 不跑）。
 */
import type { HookJSONOutput, Options, PermissionMode, PreToolUseHookInput, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

// 1. hook input：PreToolUse 带 tool_name / tool_input / session_id / cwd（M2-1 的 hook CLI 依赖这些字段）。
const hookInput = {} as PreToolUseHookInput;
export const usedHookFields: [string, unknown, string, string] = [hookInput.tool_name, hookInput.tool_input, hookInput.session_id, hookInput.cwd];

// 2. hook output：deny 用 hookSpecificOutput.permissionDecision = 'deny' + permissionDecisionReason。
export const deny: HookJSONOutput = {
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Stagent 守卫：…' },
};

// 3. permission mode：我们用 acceptEdits（实现 / 起草）与 dontAsk（只读，未预先允许的工具一律拒绝）。
export const modes: PermissionMode[] = ['acceptEdits', 'dontAsk'];

// 4. 选项：cwd、settingSources（project → .claude/settings.json 的 hooks 生效）、allowedTools / disallowedTools、
//    resume（会话续接）、maxBudgetUsd（费用上限）、abortController。
export const options: Options = {
  cwd: '/project',
  settingSources: ['project'],
  permissionMode: 'acceptEdits',
  allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'MultiEdit', 'Bash'],
  disallowedTools: ['Bash'],
  resume: '00000000-0000-0000-0000-000000000000',
  maxBudgetUsd: 1,
  abortController: new AbortController(),
};

// 5. 流式消息：每条消息都有 session_id；result 消息带 total_cost_usd、usage、modelUsage、subtype。
export function usage(m: SDKMessage): { sessionId: string; cost?: number; input?: number; output?: number } {
  if (m.type === 'result') {
    const r: SDKResultMessage = m;
    return { sessionId: r.session_id, cost: r.total_cost_usd, input: r.usage.input_tokens, output: r.usage.output_tokens };
  }
  // 并非每种消息都保证有 session_id（适配器里按 typeof 判断）。
  return { sessionId: m.session_id ?? '' };
}
export const budgetSubtype: SDKResultMessage['subtype'] = 'error_max_budget_usd';

export const run = () => query({ prompt: 'hi', options });
