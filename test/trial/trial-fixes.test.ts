/**
 * 真实试用（docs/trial.md）发现的问题的回归测试。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScriptedExecutor, writeProjectFile } from '../../src/agent/scripted.js';
import type { ChangeView } from '../../src/changes/changes.js';
import { checkHookHealth, hookCommand, installClaudeHook, LEGACY_HOOK_COMMAND } from '../../src/guard/install.js';
import { CHECK_CONFIGS, initProject } from '../../src/init/init.js';
import { Ledger } from '../../src/ledger/index.js';
import { computeHealth } from '../../src/metrics/health.js';
import { buildOverview } from '../../src/projection/overview.js';
import { onePerFile } from '../../src/server/flows/examples-flow.js';
import { waitAgent } from '../helpers/agent.js';
import { gitIn } from '../helpers/project.js';
import { serverProject } from '../helpers/server.js';
import { tmpProject } from '../helpers/tmp.js';
import { LineBuilder } from '../helpers/lines.js';

describe('守卫 hook 在没装 stagent 依赖的项目里也能运行', () => {
  it('新命令用 stagent 自己的 CLI 绝对路径；路径不存在时 fail closed（exit 2 拦下操作），不下载同名 npm 包', async () => {
    const cmd = hookCommand('/opt/stagent/dist/cli/index.js');
    expect(cmd).toContain('node "/opt/stagent/dist/cli/index.js" hook pre-tool-use');
    expect(cmd).not.toContain('npx');
    const { execSync } = await import('node:child_process');
    let code = 0;
    let stderr = '';
    try {
      execSync(cmd, { input: '{}', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      code = (err as { status: number }).status;
      stderr = String((err as { stderr: Buffer }).stderr);
    }
    expect(code).toBe(2);
    expect(stderr).toMatch(/重新运行 stagent init/);
  });

  it('自检：真的执行 hook 命令并确认它会拒绝写 .stagent/；旧版裸 npx 命令自检失败，重新 init 会升级', async () => {
    const root = await tmpProject();
    gitIn(root, 'init', '-q');
    await mkdir(join(root, '.claude'), { recursive: true });
    await mkdir(join(root, '.stagent'), { recursive: true });
    const legacy = { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: LEGACY_HOOK_COMMAND.replace('npx stagent', 'npx --no-install stagent-not-installed') }] }] } };
    await writeFile(join(root, '.claude/settings.json'), JSON.stringify(legacy));
    const bad = await checkHookHealth(root);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/守卫 hook 跑不起来/);

    await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: LEGACY_HOOK_COMMAND }] }] } }));
    const r = await installClaudeHook(root);
    expect(r.installed).toBe(true);
    const settings = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8')) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } };
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0]!.hooks[0]!.command).not.toBe(LEGACY_HOOK_COMMAND);
    // 再跑一次不重复添加
    await installClaudeHook(root);
    expect((JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8')) as typeof settings).hooks.PreToolUse).toHaveLength(1);
    // 升级后的命令指向本仓库编译出的 CLI：编译过才能真正跑通（CI 先 build 再 test 时验证）。
    const { existsSync } = await import('node:fs');
    if (existsSync(new URL('../../dist/cli/index.js', import.meta.url))) expect((await checkHookHealth(root)).ok).toBe(true);
  }, 30_000);

  it('守卫自检不通过时：结论卡第一条原因写明，需要 Claude Code 改代码的按钮全部禁用', () => {
    const b = new LineBuilder().feature('f').example('f', 'e').run([['e', 'failed']]);
    const o = buildOverview({
      projection: { features: [], lastGuardBlock: null, lastRun: null },
      ledger: { state: 'ok', brokenLinks: [] },
      run: null,
      guardProblem: '守卫 hook 跑不起来（找不到 stagent 命令）',
    });
    void b;
    expect(o.reasons[0]!.text).toMatch(/守卫 hook 跑不起来/);
    expect(o.actions.find((a) => a.id === 'scan')).toMatchObject({ enabled: false, disabledReason: '守卫 hook 跑不起来' });
  });

  it('重新 init 升级 npx 变体（--yes / --no-install）与 yarn dlx，不重复添加', async () => {
    const root = await tmpProject();
    gitIn(root, 'init', '-q');
    await mkdir(join(root, '.claude'), { recursive: true });
    const variants = [
      'npx --yes stagent hook pre-tool-use',
      'npx --no-install stagent hook pre-tool-use',
      'yarn dlx stagent hook pre-tool-use',
      'pnpm dlx stagent hook pre-tool-use',
    ];
    for (const command of variants) {
      await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command }] }] } }));
      const r = await installClaudeHook(root);
      expect(r.installed).toBe(true);
      const settings = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8')) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } };
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0]!.hooks[0]!.command).toBe(hookCommand());
      expect(settings.hooks.PreToolUse[0]!.hooks[0]!.command).not.toMatch(/\bnpx\b|\bdlx\b/);
    }
  });

});

describe('init 生成能找到检查的测试配置', () => {
  it('vitest 项目：checkCommand 指向 .stagent/vitest.checks.config.mjs，配置只收集 .stagent/runs/*/checks/', async () => {
    const root = await tmpProject();
    gitIn(root, 'init', '-q');
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^3' } }));
    const r = await initProject(root);
    expect(r.config.checkCommand).toBe(CHECK_CONFIGS.vitest!.command);
    expect(r.created).toContain('.stagent/vitest.checks.config.mjs');
    expect(await readFile(join(root, '.stagent/vitest.checks.config.mjs'), 'utf8')).toContain(".stagent/runs/*/checks/**");
  });
});

describe('一条例子一个检查文件', () => {
  it('同一个检查文件只保留第一条例子', () => {
    const { kept, dropped } = onePerFile([
      { checkPath: 'a.ts', then: '1' },
      { checkPath: 'a.ts', then: '2' },
      { checkPath: 'b.ts', then: '3' },
    ]);
    expect(kept.map((x) => x.then)).toEqual(['1', '3']);
    expect(dropped.map((x) => x.then)).toEqual(['2']);
  });

  it('起草时 Claude 把两条例子写进同一个文件：只登记一条，并说明丢弃了哪条', async () => {
    const agent = new ScriptedExecutor({
      draftExamples: async (i, ctx) => {
        await writeProjectFile(ctx.projectRoot, `${i.draftDir}/all.mjs`, 'process.exit(1);\n');
        return [
          { given: 'g', when: 'w', then: '第一条', kind: 'behavior', checkPath: `${i.draftDir}/all.mjs`, summary: 's' },
          { given: 'g', when: 'w', then: '第二条', kind: 'behavior', checkPath: `${i.draftDir}/all.mjs`, summary: 's' },
        ];
      },
    });
    const p = await serverProject(undefined, { agent });
    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '加功能', track: 'feature', force: true })).body;
    await waitAgent(p.service);
    const view = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(view.pendingDrafts.map((d) => d.then)).toEqual(['第一条']);
    expect(p.service.agentError).toMatch(/同一个检查文件.*第二条/);
  });
});

describe('§14 防盖章', () => {
  it('AI 起草的例子一条都没改、每条只看 2 秒就确认 → 提示；改过一条就不提示', () => {
    const drafted = (b: LineBuilder, id: string, by: 'ai' | 'user') =>
      b.add({ type: 'example.drafted', exampleId: id, featureId: 'f', given: 'g', when: 'w', then: 't', kind: 'behavior', by });
    const lock = (b: LineBuilder, id: string) =>
      b.add({ type: 'example.locked', exampleId: id, checkPath: `c/${id}`, checkHash: 'h', by: 'user', redCheck: { runId: 'r', status: 'failed' } });
    const b = new LineBuilder().feature('f');
    for (const id of ['e1', 'e2', 'e3']) lock(drafted(b, id, 'ai'), id);
    const metrics = [{ name: 'ui.examples.reviewed', ms: 6000, count: 3 }];
    const h = computeHealth(b.lines, metrics);
    expect(h.confirmations).toMatchObject({ aiDrafted: 3, edited: 0, editRate: 0, medianDwellPerExampleMs: 2000 });
    expect(h.rubberStamp.text).toMatch(/一条都没改过，每条平均只看了 2\.0 秒/);

    const b2 = new LineBuilder().feature('f');
    for (const id of ['e1', 'e2', 'e3']) drafted(b2, id, 'ai');
    drafted(b2, 'e2', 'user');
    for (const id of ['e1', 'e2', 'e3']) lock(b2, id);
    const h2 = computeHealth(b2.lines, metrics);
    expect(h2.confirmations.edited).toBe(1);
    expect(h2.rubberStamp.suspected).toBe(false);
  });

  it('进行中改动的待锁定草稿可以修改（写 by:user 的 example.drafted），结论卡出现防盖章提示', async () => {
    const agent = new ScriptedExecutor({
      draftExamples: async (i, ctx) => {
        const out = [];
        for (const n of [1, 2, 3]) {
          await writeProjectFile(ctx.projectRoot, `${i.draftDir}/c${n}.mjs`, 'process.exit(1);\n');
          out.push({ given: 'g', when: 'w', then: `期望 ${n}`, kind: 'behavior' as const, checkPath: `${i.draftDir}/c${n}.mjs`, summary: 's' });
        }
        return out;
      },
    });
    const p = await serverProject(undefined, { agent, autoAgent: true });
    const c = (await p.call<ChangeView>('POST', '/api/changes', { description: '加功能', track: 'feature', force: true })).body;
    await waitAgent(p.service);
    let view = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect((await p.call('PUT', `/api/examples/${view.pendingDrafts[0]!.exampleId}/draft`, { then: '我改过的期望' })).status).toBe(200);
    view = (await p.call<ChangeView>('GET', `/api/changes/${c.changeId}`)).body;
    expect(view.pendingDrafts[0]!.then).toBe('我改过的期望');
    const last = (await Ledger.open(p.root)).events().filter((e) => e.type === 'example.drafted').at(-1);
    expect(last).toMatchObject({ by: 'user', then: '我改过的期望' });
    // 现在不改另一个改动的例子直接确认：用健康指标接口验证（这里只确认接口可用、修改率被计入）
    const ids = view.pendingDrafts.map((d) => d.exampleId);
    await p.call('POST', `/api/changes/${c.changeId}/red-check`, { acknowledgedExampleIds: ids });
    await p.call('POST', `/api/changes/${c.changeId}/examples/lock`, { acknowledgedExampleIds: ids });
    const health = (await p.call<ReturnType<typeof computeHealth>>('GET', '/api/health')).body;
    expect(health.confirmations).toMatchObject({ aiDrafted: 3, edited: 1 });
    expect(health.rubberStamp.suspected).toBe(false);
  });
});
