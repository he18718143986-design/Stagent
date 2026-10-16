/**
 * stagent init 安装的守卫钩子（规格 §6）：
 *
 * - .claude/settings.json 的 PreToolUse hook（见 hookCommand）。合并进已有文件，不动其他键和别的 hook；
 *   已经装过（任一 hook 命令包含 `stagent hook pre-tool-use`）就不再重复添加；旧版 npx/dlx 变体以及过期绝对路径都会升级为当前 fail-closed 命令。
 * - .git/hooks/pre-merge-commit 提醒脚本：只提醒"请通过 Stagent 合并"，永远 exit 0、不阻止合并。
 *   用 `# stagent` 标记识别自己的脚本；已有别人的同名钩子则跳过并警告；config.guard.preMergeReminder=false 时不装并删除自己的。
 */
import { existsSync } from 'node:fs';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLAUDE_SETTINGS_RELATIVE_PATH = join('.claude', 'settings.json');
/** 旧版（M2-1）写入的命令：项目没有把 stagent 装成依赖时 `npx stagent` 找不到命令、exit 127，Claude Code 会当作非阻塞错误直接放行。 */
export const LEGACY_HOOK_COMMAND = 'npx stagent hook pre-tool-use';

/**
 * 守卫 hook 命令。真实试用（docs/trial.md）发现裸 `npx stagent` 在没装依赖的项目里 exit 127，
 * Claude Code 把非 0/2 退出当作非阻塞错误放行——守卫等于没开。所以：
 * 1. 用运行 init 的这份 stagent 的绝对路径（`node <cli>`）；
 * 2. 那个路径不存在了（npx 缓存被清、换了机器）就 **fail closed**：exit 2 让 Claude Code 拦下这次工具调用并说明原因。
 *    不退回 `npx stagent`——npm 上同名的包未必是这个项目，自动下载执行一个陌生包比拦下写入危险得多。
 */
export function hookCommand(cliPath = defaultCliPath()): string {
  const q = cliPath.replace(/'/g, `'\\''`);
  return `sh -c 'if [ -f "${q}" ]; then exec node "${q}" hook pre-tool-use; else echo "Stagent 守卫找不到 ${q}，已拦下这次操作：请在项目里重新运行 stagent init" >&2; exit 2; fi'`;
}

/** 兼容旧导出：当前环境下 init 写入的命令。 */
export const HOOK_COMMAND = hookCommand();

function defaultCliPath(): string {
  // src/guard/install.ts 与 dist/guard/install.js 都在包根目录下两级；优先指向编译后的 CLI。
  const dist = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
  return existsSync(dist) ? dist : fileURLToPath(new URL('../cli/index.js', import.meta.url));
}


export const HOOK_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Bash';
export const PRE_MERGE_MARKER = '# stagent pre-merge-commit reminder';

export interface ClaudeHookResult {
  /** 本次新写入了 hook。 */
  installed: boolean;
  /** 本次新建了 settings.json。 */
  createdFile: boolean;
  warning?: string;
}

export async function installClaudeHook(projectRoot: string): Promise<ClaudeHookResult> {
  const path = join(projectRoot, CLAUDE_SETTINGS_RELATIVE_PATH);
  let settings: Record<string, unknown> = {};
  let createdFile = true;
  try {
    const text = await readFile(path, 'utf8');
    createdFile = false;
    const parsed: unknown = text.trim() === '' ? {} : JSON.parse(text);
    if (!isObject(parsed)) throw new Error('顶层不是对象');
    settings = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        installed: false,
        createdFile: false,
        warning: `${CLAUDE_SETTINGS_RELATIVE_PATH} 无法解析（${(err as Error).message}），未写入守卫 hook；请手动添加 PreToolUse hook：${HOOK_COMMAND}`,
      };
    }
  }

  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  const pre = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];
  // 升级任何仍不是当前 fail-closed 绝对路径的 Stagent hook（裸 npx、带 flag 的 npx、
  // yarn/pnpm/bunx dlx、以及另一台机器留下的旧绝对路径）。只认一字不差的 LEGACY 会漏掉变体。
  let upgraded = false;
  for (const entry of pre) {
    if (!isObject(entry) || !Array.isArray(entry.hooks)) continue;
    for (const h of entry.hooks) {
      if (isObject(h) && needsHookCommandUpgrade(h.command)) {
        h.command = HOOK_COMMAND;
        upgraded = true;
      }
    }
  }
  if (pre.some(hasStagentHook)) {
    if (upgraded) {
      settings.hooks = { ...hooks, PreToolUse: pre };
      await writeFile(path, JSON.stringify(settings, null, 2) + '\n');
    }
    return { installed: upgraded, createdFile: false };
  }

  pre.push({ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  settings.hooks = { ...hooks, PreToolUse: pre };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n');
  return { installed: true, createdFile };
}

function hasStagentHook(entry: unknown): boolean {
  if (!isObject(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h) => isObject(h) && isStagentHookCommand(h.command));
}

/** 是不是 Stagent 的守卫命令（旧版 `npx stagent hook …`、新版 `node <stagent cli> hook …` 都算）。 */
export function isStagentHookCommand(command: unknown): command is string {
  return typeof command === 'string' && command.includes('hook pre-tool-use') && /stagent/i.test(command);
}

/**
 * 这条 hook 命令是否应在 init 时升级为当前 `hookCommand()`。
 * 覆盖：一字不差的 LEGACY、`npx --yes`/`--no-install`/`-y` 等变体、`npm exec`/`yarn dlx`/`pnpm dlx`/`bunx`，
 * 以及非当前绝对路径的旧安装（换机器 / 清缓存后路径失效）。
 */
export function needsHookCommandUpgrade(command: unknown): boolean {
  if (!isStagentHookCommand(command)) return false;
  if (command === HOOK_COMMAND) return false;
  return true;
}

/** @deprecated 仅兼容测试与文档；请用 needsHookCommandUpgrade / isStagentHookCommand。 */
export function isLegacyNpxHookCommand(command: unknown): boolean {
  return (
    isStagentHookCommand(command) &&
    /\b(npx|npm\s+exec|yarn\s+dlx|pnpm\s+dlx|bunx)\b/i.test(command)
  );
}

export type PreMergeReminderStatus = 'installed' | 'unchanged' | 'skipped' | 'removed' | 'disabled' | 'no-git';

export function preMergeScript(): string {
  return `#!/bin/sh
${PRE_MERGE_MARKER}（只提醒，不阻止合并；关闭：.stagent/config.json 设 "guard": { "preMergeReminder": false } 后重新运行 stagent init）
# Stagent 自己合并时会设置 STAGENT_MERGE=1，不再提醒。
[ -n "$STAGENT_MERGE" ] && exit 0
echo "⚠️  Stagent 提醒：这次合并没有经过 Stagent。建议在 Stagent 页面里合并，它会先确认锁定的验收例子都已验证。本提醒不会阻止合并。" >&2
exit 0
`;
}

export async function installPreMergeReminder(
  projectRoot: string,
  enabled: boolean,
): Promise<{ status: PreMergeReminderStatus; warning?: string }> {
  const hooksDir = join(projectRoot, '.git', 'hooks');
  if (!(await exists(hooksDir))) return { status: 'no-git' };
  const path = join(hooksDir, 'pre-merge-commit');
  const current = await readFile(path, 'utf8').catch(() => null);
  const ours = current !== null && current.includes(PRE_MERGE_MARKER);

  if (!enabled) {
    if (ours) {
      await rm(path, { force: true });
      return { status: 'removed' };
    }
    return { status: 'disabled' };
  }
  if (current !== null && !ours) {
    return { status: 'skipped', warning: '.git/hooks/pre-merge-commit 已存在且不是 Stagent 的，未安装合并提醒' };
  }
  const script = preMergeScript();
  if (current === script) return { status: 'unchanged' };
  await writeFile(path, script);
  await chmod(path, 0o755);
  return { status: ours ? 'unchanged' : 'installed' };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface HookHealth {
  ok: boolean;
  /** 不 ok 时给人看的原因。 */
  reason?: string;
  command?: string;
}

/**
 * 确认 .claude/settings.json 里的守卫 hook 真的能运行并会拒绝写 .stagent/（服务启动时调用）。
 * hook 跑不起来时 Claude Code 默认放行，所以这里不通过时，Stagent 不应该驱动 Claude Code 改代码。
 */
export async function checkHookHealth(projectRoot: string, timeoutMs = 20_000): Promise<HookHealth> {
  let command: string | undefined;
  try {
    const settings = JSON.parse(await readFile(join(projectRoot, CLAUDE_SETTINGS_RELATIVE_PATH), 'utf8')) as Record<string, unknown>;
    const pre = isObject(settings.hooks) && Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
    for (const entry of pre) {
      if (!isObject(entry) || !Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) if (isObject(h) && isStagentHookCommand(h.command)) command = h.command;
    }
  } catch {
    return { ok: false, reason: `${CLAUDE_SETTINGS_RELATIVE_PATH} 不存在或无法解析：运行 stagent init 安装守卫 hook` };
  }
  if (!command) return { ok: false, reason: `${CLAUDE_SETTINGS_RELATIVE_PATH} 里没有 Stagent 守卫 hook：运行 stagent init 安装` };
  const probe = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'stagent-selfcheck', cwd: projectRoot, tool_name: 'Write', tool_input: { file_path: '.stagent/ledger/selfcheck' } });
  const { spawn } = await import('node:child_process');
  const out = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(command!, { cwd: projectRoot, shell: true, env: { ...process.env, STAGENT_HOOK_SELFCHECK: '1' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
    child.stdin.end(probe);
  });
  if (out.code === 0 && out.stdout.includes('"permissionDecision":"deny"')) return { ok: true, command };
  const reason = out.code === 127 || out.code === 2 || /not found|找不到/.test(out.stderr) ? '找不到 stagent 命令' : `退出码 ${String(out.code)}${out.stderr ? `：${out.stderr.trim().slice(0, 200)}` : ''}`;
  return { ok: false, command, reason: `守卫 hook 跑不起来（${reason}），Claude Code 的写入不会被拦截：重新运行 stagent init 修复` };
}
