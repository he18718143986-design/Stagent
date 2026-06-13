/**
 * 可体验交付 P0 单测：injectDemoStages（注入/幂等/锚点/命令推断）+
 * evaluateDemoArtifacts（exit/summary/schema/quickstart/plot 各 violation）。
 * 仿 behavior-spec-gate.test.ts 夹具模式（node:test + tmp 工作区）。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Stage } from '../WorkflowDefinition';
import type { CodeRunnerConfig } from '../workflow-types/StageTypes';
import {
  DEMO_ENTRY_REL,
  DEMO_GENERATE_STAGE_ID,
  DEMO_RUN_STAGE_ID,
  inferDemoModality,
  injectDemoStages,
} from '../disk-bootstrap/demoStage';
import { DELIVERY_WRAPUP_STAGE_ID } from '../disk-bootstrap/deliveryWrapupStage';
import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import {
  evaluateDemoArtifacts,
  hardDemoIssues,
  type DemoArtifactGateOptions,
} from '../quality-gates/DemoArtifactGate';

// ---------- 夹具 ----------

function implStage(): Stage {
  return {
    id: 'stage_impl_indicators',
    title: 'impl',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'impl',
      writeOutputToFile: 'indicators/__init__.py',
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
}

function configWriteStage(): Stage {
  return {
    id: 'stage_write_config',
    title: 'write config',
    tool: 'file-write',
    toolConfig: {
      type: 'file-write',
      filePath: 'config.yaml',
      sourceOutputKey: 'config',
      pathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'configFile', format: 'file-path' }],
    pauseAfter: false,
  };
}

function deliveryStage(): Stage {
  return {
    id: DELIVERY_WRAPUP_STAGE_ID,
    title: 'delivery',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'd', writeOutputToFile: 'DELIVERY.md' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'delivery', format: 'markdown' }],
    pauseAfter: true,
  };
}

function serveImplStage(): Stage {
  return {
    id: 'stage_run_server',
    title: 'serve',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'uvicorn app:app', captureOutput: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'serve', format: 'text' }],
    pauseAfter: false,
  };
}

function smokeStage(): Stage {
  return {
    id: SMOKE_RUN_STAGE_ID,
    title: 'smoke',
    tool: 'code-runner',
    toolConfig: { type: 'code-runner', command: 'node app.js', captureOutput: true, serve: true },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'smokeOutput', format: 'text' }],
    pauseAfter: false,
  };
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'demo-gate-'));
}

function writeWorkspaceFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const GOOD_SUMMARY = JSON.stringify({ ran: true, signals: 3, rows: 240 });

// ---------- injectDemoStages ----------

test('inject：在 delivery 前插入 generate→run，dependsOn 串联', () => {
  const stages = injectDemoStages([implStage(), deliveryStage()]);
  const ids = stages.map((s) => s.id);
  assert.deepEqual(ids, [
    'stage_impl_indicators',
    DEMO_GENERATE_STAGE_ID,
    DEMO_RUN_STAGE_ID,
    DELIVERY_WRAPUP_STAGE_ID,
  ]);
  const gen = stages.find((s) => s.id === DEMO_GENERATE_STAGE_ID)!;
  const run = stages.find((s) => s.id === DEMO_RUN_STAGE_ID)!;
  assert.deepEqual(gen.dependsOn, ['stage_impl_indicators']);
  assert.deepEqual(run.dependsOn, [DEMO_GENERATE_STAGE_ID]);
});

test('inject：锚点优先 delivery 前一阶段（smoke 在场时锚 smoke）', () => {
  const stages = injectDemoStages([implStage(), smokeStage(), deliveryStage()]);
  const gen = stages.find((s) => s.id === DEMO_GENERATE_STAGE_ID)!;
  assert.deepEqual(gen.dependsOn, [SMOKE_RUN_STAGE_ID]);
});

test('inject：幂等（重复调用不重复注入）', () => {
  const once = injectDemoStages([implStage(), deliveryStage()]);
  const twice = injectDemoStages(once);
  assert.equal(twice.filter((s) => s.id === DEMO_GENERATE_STAGE_ID).length, 1);
  assert.equal(twice.filter((s) => s.id === DEMO_RUN_STAGE_ID).length, 1);
});

test('inject：无实现产物（仅测试写）→ 不注入', () => {
  const testOnly: Stage = {
    id: 'stage_test_write_indicators',
    title: 'tw',
    tool: 'llm-text',
    toolConfig: {
      type: 'llm-text',
      systemPrompt: 'tw',
      writeOutputToFile: 'tests/test_indicators.py',
      writePathBase: 'workspace',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
  const stages = injectDemoStages([testOnly]);
  assert.equal(stages.some((s) => s.id === DEMO_GENERATE_STAGE_ID), false);
});

test('inject：enabled=false → 不注入', () => {
  const stages = injectDemoStages([implStage(), deliveryStage()], { enabled: false });
  assert.equal(stages.some((s) => s.id === DEMO_GENERATE_STAGE_ID), false);
});

test('inject：无 delivery 阶段时追加到末尾', () => {
  const stages = injectDemoStages([implStage()]);
  assert.deepEqual(stages.map((s) => s.id), [
    'stage_impl_indicators',
    DEMO_GENERATE_STAGE_ID,
    DEMO_RUN_STAGE_ID,
  ]);
});

test('inject：有 config 写盘阶段 → demo 命令附 --config', () => {
  const stages = injectDemoStages([implStage(), configWriteStage(), deliveryStage()]);
  const run = stages.find((s) => s.id === DEMO_RUN_STAGE_ID)!;
  const cmd = (run.toolConfig as CodeRunnerConfig).command;
  assert.match(cmd, /run_demo\.py --config config\.yaml$/);
  assert.match(cmd, new RegExp(DEMO_ENTRY_REL.replace(/[/.]/g, '\\$&')));
});

test('inject：无 config 写盘阶段 → demo 命令不附 --config', () => {
  const stages = injectDemoStages([implStage(), deliveryStage()]);
  const run = stages.find((s) => s.id === DEMO_RUN_STAGE_ID)!;
  const cmd = (run.toolConfig as CodeRunnerConfig).command;
  assert.doesNotMatch(cmd, /--config/);
});

// ---------- 模态推断 ----------

test('modality：无 serve 命令 → oneShot-text', () => {
  assert.equal(inferDemoModality([implStage(), deliveryStage()]).modality, 'oneShot-text');
});

test('modality：计划含 serve 命令 → serve-probe（复用该命令）', () => {
  const plan = inferDemoModality([implStage(), serveImplStage(), deliveryStage()]);
  assert.equal(plan.modality, 'serve-probe');
  assert.equal(plan.serveCommand, 'uvicorn app:app');
});

test('modality：smoke 自注入阶段不被误判为 serve 源', () => {
  // smokeStage 命令 'node app.js' 命中 serve 模式，但应被排除 → 仍 oneShot-text
  const plan = inferDemoModality([implStage(), smokeStage(), deliveryStage()]);
  assert.equal(plan.modality, 'oneShot-text');
});

test('inject：serve-probe 模态 → run 阶段为 serve + readyProbe', () => {
  const stages = injectDemoStages([implStage(), serveImplStage(), deliveryStage()]);
  const run = stages.find((s) => s.id === DEMO_RUN_STAGE_ID)!;
  const cfg = run.toolConfig as CodeRunnerConfig;
  assert.equal(cfg.command, 'uvicorn app:app');
  assert.equal(cfg.serve, true);
  assert.match(cfg.readyProbe ?? '', /run_demo\.py/);
});

test('inject：oneShot-text 模态 → run 阶段非 serve', () => {
  const stages = injectDemoStages([implStage(), deliveryStage()]);
  const run = stages.find((s) => s.id === DEMO_RUN_STAGE_ID)!;
  const cfg = run.toolConfig as CodeRunnerConfig;
  assert.notEqual(cfg.serve, true);
  assert.match(cfg.command, /run_demo\.py/);
});

// ---------- evaluateDemoArtifacts ----------

test('gate：产物齐全（summary + quickstart）→ 无 issue', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行\n`python demo/run_demo.py`\n## 预期输出\n信号条数');
  assert.equal(evaluateDemoArtifacts(ws, { exitCode: 0 }).length, 0);
});

test('gate：exit 非 0 → demo-run-failed 且短路', () => {
  const ws = makeWorkspace();
  const issues = evaluateDemoArtifacts(ws, { exitCode: 1 });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'demo-run-failed');
  assert.equal(issues[0].hard, true);
});

test('gate：summary 缺失 → demo-summary-missing', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-summary-missing' && i.hard));
});

test('gate：summary 空文件 → demo-summary-empty', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', '   ');
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-summary-empty'));
});

test('gate：summary 非法 JSON → demo-summary-invalid-json', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', '{not json');
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-summary-invalid-json'));
});

test('gate：summary 是数组而非对象 → demo-summary-invalid-json', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', '[1,2,3]');
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-summary-invalid-json'));
});

test('gate：显式 requiredSummaryKeys 缺键 → demo-summary-schema', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', JSON.stringify({ ran: true }));
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0, requiredSummaryKeys: ['ran', 'signals'] });
  const schema = issues.find((i) => i.code === 'demo-summary-schema')!;
  assert.ok(schema);
  assert.match(schema.message, /signals/);
});

test('gate：schema 文件 requiredKeys 生效（无显式参数时）', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', JSON.stringify({ ran: true }));
  writeWorkspaceFile(ws, 'demo/summary.schema.json', JSON.stringify({ requiredKeys: ['ran', 'rows'] }));
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-summary-schema' && /rows/.test(i.message)));
});

test('gate：显式 requiredSummaryKeys 优先于 schema 文件', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', JSON.stringify({ ran: true, rows: 1 }));
  writeWorkspaceFile(ws, 'demo/summary.schema.json', JSON.stringify({ requiredKeys: ['nope'] }));
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  // 显式只要 ran，schema 的 nope 被忽略 → 通过
  assert.equal(evaluateDemoArtifacts(ws, { exitCode: 0, requiredSummaryKeys: ['ran'] }).length, 0);
});

test('gate：quickstart 缺失（默认 require）→ demo-quickstart-missing', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.ok(issues.some((i) => i.code === 'demo-quickstart-missing'));
});

test('gate：requireQuickstart=false → 缺 quickstart 不报', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  assert.equal(evaluateDemoArtifacts(ws, { exitCode: 0, requireQuickstart: false }).length, 0);
});

test('gate：requirePlot 且合法 PNG → 通过', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(200, 0),
  ]);
  fs.writeFileSync(path.join(ws, 'demo/equity.png'), png);
  const opts: DemoArtifactGateOptions = {
    exitCode: 0,
    requirePlot: true,
    plotRelPath: 'demo/equity.png',
  };
  assert.equal(evaluateDemoArtifacts(ws, opts).length, 0);
});

test('gate：requirePlot 但 PNG 头非法 → demo-plot-invalid', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  fs.writeFileSync(path.join(ws, 'demo/equity.png'), Buffer.alloc(200, 0x41));
  const issues = evaluateDemoArtifacts(ws, {
    exitCode: 0,
    requirePlot: true,
    plotRelPath: 'demo/equity.png',
  });
  assert.ok(issues.some((i) => i.code === 'demo-plot-invalid'));
});

test('gate：requirePlot 但图过小 → demo-plot-invalid', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  fs.writeFileSync(path.join(ws, 'demo/equity.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const issues = evaluateDemoArtifacts(ws, {
    exitCode: 0,
    requirePlot: true,
    plotRelPath: 'demo/equity.png',
  });
  assert.ok(issues.some((i) => i.code === 'demo-plot-invalid'));
});

test('gate：exitCode 未提供（仅静态产物检查）→ 产物齐全则通过', () => {
  const ws = makeWorkspace();
  writeWorkspaceFile(ws, 'demo/summary.json', GOOD_SUMMARY);
  writeWorkspaceFile(ws, 'QUICKSTART.md', '# 运行');
  assert.equal(evaluateDemoArtifacts(ws).length, 0);
});

test('hardDemoIssues：过滤 hard 子集', () => {
  const ws = makeWorkspace();
  const issues = evaluateDemoArtifacts(ws, { exitCode: 0 });
  assert.equal(hardDemoIssues(issues).length, issues.filter((i) => i.hard).length);
  assert.ok(hardDemoIssues(issues).length > 0);
});
