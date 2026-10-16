/**
 * stagent init（规格 §9 第 1 步，不含扫描）：
 * 写入 .stagent/ 目录、账本 meta 行、.gitignore 条目，检测技术栈生成 config.json 草稿；
 * M2-1 起还写入 .claude/settings.json 的 PreToolUse 守卫 hook 与 .git/hooks/pre-merge-commit 提醒（见 src/guard/install.ts）。
 *
 * 不在本模块：~/.stagent 链头（M6-1）、扫描功能（M4-1）。
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_RELATIVE_PATH, DEFAULT_CONFIG, resolveConfig } from '../config/config.js';
import { CLAUDE_SETTINGS_RELATIVE_PATH, installClaudeHook, installPreMergeReminder, type PreMergeReminderStatus } from '../guard/install.js';
import { isGitRepo } from '../git/git.js';
import { Ledger } from '../ledger/ledger.js';

/** 需要写进项目 .gitignore 的条目：运行产物与服务锁不提交。 */
export const GITIGNORE_ENTRIES = ['.stagent/runs/', '.stagent/docs/', '.stagent/service.lock'];

export interface InitResult {
  projectId: string;
  /** 本次新建的路径（相对项目根目录）。 */
  created: string[];
  gitignoreAdded: string[];
  config: Record<string, unknown>;
  detected: DetectedStack;
  /** 本次新写入了 .claude/settings.json 的 PreToolUse 守卫 hook（已存在时为 false）。 */
  hooksInstalled: boolean;
  preMergeReminder: PreMergeReminderStatus;
  warnings: string[];
}

export interface DetectedStack {
  framework: 'next' | 'vite' | 'node' | 'python' | 'unknown';
  testRunner: 'playwright' | 'vitest' | 'jest' | 'pytest' | 'unknown';
}

export async function initProject(projectRoot: string): Promise<InitResult> {
  const created: string[] = [];
  const warnings: string[] = [];
  if (!(await isGitRepo(projectRoot))) {
    warnings.push('当前目录不是 git 仓库：Stagent 依赖 git 计算基准与 workTreeHash，请先 git init');
  }

  for (const dir of ['.stagent/ledger', '.stagent/checks']) {
    if (!(await exists(join(projectRoot, dir)))) created.push(dir + '/');
    await mkdir(join(projectRoot, dir), { recursive: true });
  }

  const ledgerExisted = await exists(Ledger.pathFor(projectRoot));
  const ledger = await Ledger.init(projectRoot);
  if (!ledgerExisted) created.push('.stagent/ledger/events.jsonl');
  if (ledger.state === 'locked') warnings.push('已有账本与事件链不符（🔒），启动服务后需要确认');

  const detected = await detectStack(projectRoot);
  const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);
  let config: Record<string, unknown>;
  if (await exists(configPath)) {
    config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } else {
    config = await draftConfig(projectRoot, detected);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    created.push(CONFIG_RELATIVE_PATH);
  }
  const checkConfig = CHECK_CONFIGS[detected.testRunner];
  if (checkConfig && config.checkCommand === checkConfig.command && !(await exists(join(projectRoot, checkConfig.path)))) {
    await writeFile(join(projectRoot, checkConfig.path), checkConfig.content);
    created.push(checkConfig.path);
  }

  const gitignoreAdded = await ensureGitignore(projectRoot);

  const hook = await installClaudeHook(projectRoot);
  if (hook.createdFile) created.push(CLAUDE_SETTINGS_RELATIVE_PATH);
  if (hook.warning) warnings.push(hook.warning);
  let reminderEnabled = DEFAULT_CONFIG.guard.preMergeReminder;
  try {
    reminderEnabled = resolveConfig(config).guard.preMergeReminder;
  } catch (err) {
    warnings.push(`config.json 校验失败（${(err as Error).message}），合并提醒按默认安装`);
  }
  const reminder = await installPreMergeReminder(projectRoot, reminderEnabled);
  if (reminder.warning) warnings.push(reminder.warning);

  return {
    projectId: ledger.projectId ?? '',
    created,
    gitignoreAdded,
    config,
    detected,
    hooksInstalled: hook.installed,
    preMergeReminder: reminder.status,
    warnings,
  };
}

export async function detectStack(projectRoot: string): Promise<DetectedStack> {
  const pkg = await readJson(join(projectRoot, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, unknown>;
    const framework: DetectedStack['framework'] = 'next' in deps ? 'next' : 'vite' in deps ? 'vite' : 'node';
    const testRunner: DetectedStack['testRunner'] =
      '@playwright/test' in deps ? 'playwright' : 'vitest' in deps ? 'vitest' : 'jest' in deps ? 'jest' : 'unknown';
    return { framework, testRunner };
  }
  if ((await exists(join(projectRoot, 'pyproject.toml'))) || (await exists(join(projectRoot, 'requirements.txt')))) {
    return { framework: 'python', testRunner: 'pytest' };
  }
  return { framework: 'unknown', testRunner: 'unknown' };
}

/**
 * 检查从快照还原到 .stagent/runs/<runId>/checks/ 下执行，项目自己的测试配置（include / testDir）通常不覆盖这个目录，
 * 测试框架会报"找不到测试"然后 exit 1——检查永远失败。真实试用（docs/trial.md）发现这一点后，
 * init **只**为 vitest / playwright 各生成一份只覆盖这个目录的检查配置，checkCommand 指向它。
 * jest / pytest / unknown 不会生成：请在 .stagent/config.json 手写 checkCommand（见 docs/guard.md）。
 */
export const CHECK_CONFIGS: Partial<Record<DetectedStack['testRunner'], { path: string; content: string; command: string }>> = {
  vitest: {
    path: '.stagent/vitest.checks.config.mjs',
    command: 'npx vitest run --config .stagent/vitest.checks.config.mjs {path}',
    content: `// Stagent 生成：锁定检查从快照还原到 .stagent/runs/<runId>/checks/ 下执行，只收集这个目录。
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['.stagent/runs/*/checks/**/*.{ts,mts,cts,js,mjs,cjs,tsx,jsx}'],
    environment: 'node',
    testTimeout: 60_000,
  },
};
`,
  },
  playwright: {
    path: '.stagent/playwright.checks.config.mjs',
    command: 'npx playwright test --config .stagent/playwright.checks.config.mjs {path}',
    content: `// Stagent 生成：锁定检查从快照还原到 .stagent/runs/<runId>/checks/ 下执行，只收集这个目录。
export default {
  testDir: './runs',
  testMatch: '**/checks/**/*.{ts,js,mjs}',
  timeout: 60_000,
  retries: 0,
};
`,
  },
};

async function draftConfig(projectRoot: string, d: DetectedStack): Promise<Record<string, unknown>> {
  const checkCommand: Record<DetectedStack['testRunner'], string> = {
    playwright: CHECK_CONFIGS.playwright!.command,
    vitest: CHECK_CONFIGS.vitest!.command,
    jest: 'npx jest {path}',
    pytest: 'pytest {path}',
    unknown: DEFAULT_CONFIG.checkCommand,
  };
  const pkg = await readJson(join(projectRoot, 'package.json'));
  const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
  const port = d.framework === 'vite' ? 5173 : 3000;
  const devServer = typeof scripts.dev === 'string' ? { command: 'npm run dev', url: `http://localhost:${port}`, timeoutMs: 60_000 } : null;
  return {
    checkCommand: checkCommand[d.testRunner],
    checkTimeoutMs: DEFAULT_CONFIG.checkTimeoutMs,
    flakyRetries: DEFAULT_CONFIG.flakyRetries,
    devServer,
    evidence: { ignoreGlobs: [...DEFAULT_CONFIG.evidence.ignoreGlobs] },
    releaseCommand: null,
    budget: { perChange: null, perDay: null },
  };
}

async function ensureGitignore(projectRoot: string): Promise<string[]> {
  const path = join(projectRoot, '.gitignore');
  const text = (await exists(path)) ? await readFile(path, 'utf8') : '';
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((e) => !lines.has(e));
  if (missing.length) {
    const prefix = text === '' || text.endsWith('\n') ? '' : '\n';
    await writeFile(path, `${text}${prefix}# stagent\n${missing.join('\n')}\n`);
  }
  return missing;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
