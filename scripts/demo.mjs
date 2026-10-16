#!/usr/bin/env node
/**
 * 演示：在临时目录生成一个示例项目，走一遍 M1–M6 的主要流程，然后启动 Stagent 服务。
 *
 *   npm run demo                 # 构建后在 0.0.0.0:4310 启动
 *   PORT=4400 node scripts/demo.mjs
 *   STAGENT_DEMO_AGENT=real node scripts/demo.mjs   # 用真实的 Claude Code（会产生费用）
 *
 * 默认用「演示执行器」代替 Claude Code（按脚本改文件、按固定格式回报，不调用模型）。
 * 示例状态：购物车结算已验证；进行中的小改动改坏了登录（被阻止、能看到超出本功能的改动与失败定位）；
 * 支付结果不稳定；有一个进行中的需求计划、一条规则提案和一张记录卡。需要先 npm run build。
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dist = new URL('../dist/index.js', import.meta.url);
const { initProject, startService, ScriptedExecutor } = await import(dist.href);

const root = join(tmpdir(), 'stagent-demo');
await rm(root, { recursive: true, force: true });
await mkdir(join(root, 'src'), { recursive: true });
process.env.STAGENT_HOME ??= join(tmpdir(), 'stagent-demo-home');
await rm(process.env.STAGENT_HOME, { recursive: true, force: true });

const files = {
  'package.json': JSON.stringify({ name: 'shop-demo', version: '1.2.0', private: true, type: 'module' }, null, 2),
  'README.md': '# shop demo\n',
  '.gitignore': 'node_modules/\n',
  'src/cart.mjs': 'export function total(items) { return items.reduce((s, i) => s + i.price * i.qty, 0); }\n',
  'src/login.mjs': "export function login(user, pass) { return user === 'alice' && pass === 'secret'; }\n",
  'src/pay.mjs': 'export function pay(amount) { return amount > 0; }\n',
  'src/util.mjs': 'export const money = (n) => `¥${n}`;\n',
};
const checks = {
  '.stagent/checks/cart/total.mjs': `const { total } = await import(process.env.STAGENT_PROJECT_ROOT + '/src/cart.mjs');
process.exit(total([{ price: 10, qty: 2 }, { price: 5, qty: 1 }]) === 25 ? 0 : 1);
`,
  '.stagent/checks/cart/empty.mjs': `const { total } = await import(process.env.STAGENT_PROJECT_ROOT + '/src/cart.mjs');
process.exit(total([]) === 0 ? 0 : 1);
`,
  '.stagent/checks/login/ok.mjs': `const { login } = await import(process.env.STAGENT_PROJECT_ROOT + '/src/login.mjs');
process.exit(login('alice', 'secret') ? 0 : 1);
`,
  '.stagent/checks/login/wrong.mjs': `const { login } = await import(process.env.STAGENT_PROJECT_ROOT + '/src/login.mjs');
process.exit(login('alice', 'nope') ? 1 : 0);
`,
  // 第一次失败、第二次通过：演示"结果不稳定"。
  '.stagent/checks/pay/ok.mjs': `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const m = process.env.STAGENT_PROJECT_ROOT + '/node_modules/.pay-warm-' + process.env.STAGENT_RUN_ID;
if (existsSync(m)) process.exit(0);
mkdirSync(process.env.STAGENT_PROJECT_ROOT + '/node_modules', { recursive: true });
writeFileSync(m, '');
process.exit(1);
`,
};
const base = ['package.json', 'README.md', '.gitignore'];
for (const path of base) await writeFile(join(root, path), files[path]);
const git = (...args) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@stagent.local', ...args], { cwd: root });
git('init', '-q', '-b', 'main');
await initProject(root);
await writeFile(join(root, '.stagent/config.json'), JSON.stringify({ checkCommand: 'node {path}', checkTimeoutMs: 10000, releaseCommand: 'echo 已发布 > released.txt', budget: { perChange: 5, perDay: 20 } }, null, 2));
git('add', '-A');
git('commit', '-q', '-m', 'demo');

// 演示执行器：模拟 Claude Code 的回报、计划、记录卡与规则（不调用模型）。
const demoAgent = new ScriptedExecutor(
  {
    classifyChange: () => ({ track: 'small', targetFeatureIds: [], suggestPlan: false, rationale: '演示' }),
    implement: () => '## 改了什么\n按描述修改了代码（演示执行器）\n\n## 取舍\n无\n\n## 例子\n无\n',
    draftPlan: (i) => ({
      rationale: '先加会员数据，再接入价格与积分，每步都能单独验收',
      steps: [
        { stepId: 's1', title: '会员等级数据', intent: '给用户加上会员等级（普通 / 黄金）', track: 'feature', featureIds: i.features.slice(1, 2).map((f) => f.featureId) },
        { stepId: 's2', title: '会员价', intent: '购物车按会员等级打 9 折', track: 'feature', featureIds: i.features.slice(0, 1).map((f) => f.featureId), dependsOn: ['s1'] },
        { stepId: 's3', title: '积分', intent: '支付成功后按金额累积积分', track: 'feature', featureIds: i.features.slice(2, 3).map((f) => f.featureId), dependsOn: ['s1'] },
      ],
    }),
    draftRecords: () => [{ kind: 'decision', title: '金额统一用整数分', body: '避免浮点误差，展示时再格式化', tags: ['数据'] }],
    draftRule: (i) => ({ text: '启动检查前先确认测试端口没有被占用', appliesWhen: `改动涉及「${i.tag}」时`, expiresWhen: '改用随机端口之后' }),
    answerDecisionQuestion: (i) => `（演示执行器）关于「${i.question}」：豁免只在你确定行为早已存在时使用，原因会进入交付报告。`,
  },
  { costPerCall: 0.12 },
);
const agent = process.env.STAGENT_DEMO_AGENT === 'real' ? undefined : demoAgent;

const port = Number(process.env.PORT ?? 4310);
const running = await startService({ root, port, host: process.env.HOST ?? '0.0.0.0', open: false, ...(agent ? { agent } : {}) });
const svc = running.service;
const call = async (method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const idle = async () => {
  for (let i = 0; i < 200; i++) {
    if (svc.agentTask) await svc.agentTask.promise;
    await svc.waitForRun();
    await svc.waitForBackground();
    if (!svc.agentTask && !svc.running) return;
  }
};
svc.options.autoAgent = false; // 演示脚本自己驱动每一步

// 1. 新功能档：购物车结算、登录与支付（写代码与检查 → 先失败检查豁免 → 锁定 → 检查 → 合并）。
for (const [path, content] of Object.entries({ ...files, ...checks })) {
  if (base.includes(path)) continue;
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), content);
}
const c1 = await call('POST', '/api/changes', { description: '接入购物车结算、登录与支付', track: 'feature', force: true });
const draft = async (change, feature, given, when, then, checkPath) => {
  const d = await call('POST', `/api/changes/${change.changeId}/examples`, { ...feature, given, when, then, checkPath });
  await call('POST', `/api/changes/${change.changeId}/examples/${d.exampleId}/red-waive`, { reason: '接入时补的例子，行为早已存在' });
  return d;
};
const cart = await draft(c1, { featureName: '购物车结算' }, '购物车里有 2 件 10 元和 1 件 5 元的商品', '查看合计', '合计显示 25 元', '.stagent/checks/cart/total.mjs');
await draft(c1, { featureId: cart.featureId }, '购物车为空', '查看合计', '合计显示 0 元', '.stagent/checks/cart/empty.mjs');
const login = await draft(c1, { featureName: '登录' }, '用户 alice 已注册', '输入正确密码登录', '登录成功', '.stagent/checks/login/ok.mjs');
await draft(c1, { featureId: login.featureId }, '用户 alice 已注册', '输入错误密码登录', '提示密码错误，不能登录', '.stagent/checks/login/wrong.mjs');
const pay = await draft(c1, { featureName: '支付' }, '订单金额 25 元', '点击支付', '支付成功', '.stagent/checks/pay/ok.mjs');
await call('POST', `/api/changes/${c1.changeId}/examples/lock`, {});
await call('PUT', `/api/changes/${c1.changeId}/attributions`, {
  attributions: [
    { path: 'src/cart.mjs', featureIds: [cart.featureId] },
    { path: 'src/login.mjs', featureIds: [login.featureId] },
    { path: 'src/pay.mjs', featureIds: [pay.featureId] },
    { path: 'src/util.mjs', featureIds: [cart.featureId, login.featureId, pay.featureId] },
  ],
});
await writeFile(join(root, 'src/util.mjs'), files['src/util.mjs'] + 'export const fen = (n) => Math.round(n * 100);\n');
await call('POST', `/api/changes/${c1.changeId}/check`);
await idle();
await call('POST', '/api/auth', { action: 'merge_override', changeId: c1.changeId, reason: '支付检查时好时坏，先合并再修' });
await idle();

// 2. 记录与规则：两条「环境」踩坑 → 规则提案；合并后的记录卡留着等你保存。
await call('POST', '/api/records', { kind: 'pitfall', title: '本地 3000 端口被占用', body: '开发服务器起不来，检查全部 errored', tags: ['环境'] });
await call('POST', '/api/records', { kind: 'pitfall', title: 'CI 上端口冲突', body: '并行任务抢同一个端口', tags: ['环境'] });

// 3. 需求计划：会员体系（确认后等你开始第一步）。
const plan = await call('POST', '/api/plans', { requirement: '加会员体系（会员等级、会员价、积分）' });
await call('POST', `/api/plans/${plan.planId}/confirm`, {});

// 4. 进行中的小改动：目标是购物车，却改坏了登录 → 被阻止；能看到「超出本功能的改动」与失败定位。
await svc.createChange({ description: '购物车合计改用整数分计算', track: 'small', targetFeatureIds: [cart.featureId] });
await writeFile(join(root, 'src/cart.mjs'), "import { fen } from './util.mjs';\nexport function total(items) { return items.reduce((s, i) => s + fen(i.price) * i.qty, 0) / 100; }\n");
await writeFile(join(root, 'src/login.mjs'), "export function login(user, pass) { return user === 'alice'; }\n");
await call('POST', `/api/changes/${svc.activeChangeId() ?? (await svc.changes()).active.changeId}/check`);
await idle();
await svc.regenerateDocs();

console.log(`Stagent 演示已启动：${running.url}（示例项目 ${root}）`);
const stop = () => void running.close().then(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
