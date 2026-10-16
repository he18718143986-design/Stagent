#!/usr/bin/env node
/**
 * SDK 合同的真实调用验证（手动运行：需要已登录的 Claude Code 或 ANTHROPIC_API_KEY，会产生少量费用）。
 *
 *   node spikes/agent-sdk/live.mjs
 *
 * 在临时目录里装一个 PreToolUse 守卫 hook（settingSources: ['project']），让 Claude 试着写 .stagent/blocked.txt：
 * 期望看到 hook 收到的 stdin、写入被拒绝；打印 session_id、usage 与 total_cost_usd；再用 resume 续接同一会话。
 */
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

const dir = await mkdtemp(join(tmpdir(), 'sdk-spike-'));
await mkdir(join(dir, '.claude'), { recursive: true });
await mkdir(join(dir, '.stagent'), { recursive: true });
const hookLog = join(dir, 'hook-input.jsonl');
const hook = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{require('fs').appendFileSync('${hookLog}',s+'\\\\n');const i=JSON.parse(s);const p=(i.tool_input&&i.tool_input.file_path)||'';if(p.includes('.stagent')){console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'spike: .stagent 受保护'}}))}})"`;
await writeFile(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|Bash', hooks: [{ type: 'command', command: hook }] }] } }, null, 2));

let sessionId = null;
for await (const m of query({
  prompt: 'Create the file .stagent/blocked.txt containing "x", then create notes.txt containing "ok". Report briefly.',
  options: { cwd: dir, settingSources: ['project'], permissionMode: 'acceptEdits', allowedTools: ['Write', 'Read'], maxBudgetUsd: 0.5 },
})) {
  sessionId ??= m.session_id;
  if (m.type === 'result') console.log('result', m.subtype, 'cost', m.total_cost_usd, 'usage', m.usage?.input_tokens, m.usage?.output_tokens, Object.keys(m.modelUsage ?? {}));
}
console.log('session', sessionId);
console.log('hook stdin sample', (await readFile(hookLog, 'utf8').catch(() => '')).split('\n')[0]?.slice(0, 300));
console.log('.stagent/blocked.txt exists?', existsSync(join(dir, '.stagent/blocked.txt')), ' notes.txt exists?', existsSync(join(dir, 'notes.txt')));

for await (const m of query({ prompt: 'What file did you create last? One word.', options: { cwd: dir, resume: sessionId, permissionMode: 'dontAsk', maxBudgetUsd: 0.2 } })) {
  if (m.type === 'result') console.log('resume result', m.subtype, m.subtype === 'success' ? m.result : '');
}
