import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveModuleExports } from '../commitment/decisionArtifactsSchema';
import {
  collectPriorSiblingModules,
  lintImplExportsAgainstModuleContract,
  lintTestCrossModulePatchTargetsAgainstContracts,
  lintTestImportsAgainstModuleContract,
  lintTestPatchTargetsAgainstModuleContract,
} from '../python-contract/ModuleContractLint';
import type { WorkflowInstance } from '../WorkflowDefinition';

test('resolveModuleExports prefers slice over global', () => {
  const slice = { version: 1 as const, files: [], modules: [{ name: 'signals', exports: ['compute'] }] };
  const global = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: ['other'] }],
  };
  assert.deepEqual(resolveModuleExports('signals', slice, global), ['compute']);
});

test('resolveModuleExports falls back to global when slice empty', () => {
  const global = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: ['alpha'] }],
  };
  assert.deepEqual(resolveModuleExports('signals', { version: 1, files: [], modules: [] }, global), [
    'alpha',
  ]);
});

test('resolveModuleExports uses slice decisionRecord before global fallback', () => {
  const global = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute'] }],
  };
  const record = '导出函数**：compute_ma, compute_boll';
  assert.deepEqual(
    resolveModuleExports('indicators', { version: 1, files: [], modules: [] }, global, record),
    ['compute_boll', 'compute_ma'],
  );
});

test('lintTestImportsAgainstModuleContract blocks undeclared symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-'));
  const testPath = 'tests/test_signals.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, testPath),
    'from signals import compute\n\ndef test_x():\n    assert compute() == 1\n',
  );
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: ['run'] }],
  };
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'signals',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-module-contract-violation');
  assert.equal(issue?.symbol, 'compute');
});

test('lintTestImportsAgainstModuleContract allows conventional main entry symbol absent from contract (T6)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-main-'));
  const testPath = 'tests/test_main.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, testPath),
    'from main import main\n\ndef test_runs():\n    main("config.yaml")\n',
  );
  // 契约只声明了编排符号，没列入口 main —— 测试导入约定入口 main 不应被拦。
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['run_pipeline'] }],
  };
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'main',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.equal(issue, null);
});

test('lintTestImportsAgainstModuleContract blocks from __init__ instead of slice module', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-'));
  const testPath = 'tests/test_indicators.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, testPath),
    'from __init__ import compute_ma, compute_boll\n',
  );
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute_ma', 'compute_boll'] }],
  };
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'indicators',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-slice-import-module-mismatch');
  assert.match(issue?.message ?? '', /from indicators import/);
});

test('lintTestImportsAgainstModuleContract blocks other wrong project module names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-'));
  const testPath = 'tests/test_indicators.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), 'from signals import run\n');
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute_ma'] }],
  };
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'indicators',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-slice-import-module-mismatch');
});

// ---- order-aware 调和（子任务 1c）：允许前序协作者，仍拦前向/未声明/__init__ ----
const T6_GLOBAL = {
  version: 1 as const,
  files: [],
  modules: [
    { name: 'models', exports: ['Task', 'validate_task'] },
    { name: 'store', exports: ['TaskStore'] },
    { name: 'statemachine', exports: ['ALLOWED_TRANSITIONS', 'can_transition', 'apply_transition', 'InvalidTransition'] },
    { name: 'pipeline', exports: ['import_tasks_from_csv', 'summarize'] },
    { name: 'main', exports: ['main'] },
  ],
};

function writeTest(rel: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-order-'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
  return dir;
}

test('collectPriorSiblingModules：按 impl 落盘序取前序兄弟（排除 bundle-write/conftest）', () => {
  const def = {
    id: 'wf',
    title: 'wf',
    stages: [
      { id: 'stage_impl_conftest' },
      { id: 'stage_impl_models' },
      { id: 'stage_impl_models_stagent_bundle_write' },
      { id: 'stage_impl_store' },
      { id: 'stage_impl_statemachine' },
      { id: 'stage_impl_pipeline' },
      { id: 'stage_impl_main' },
    ],
  } as never;
  assert.deepEqual([...collectPriorSiblingModules(def, 'pipeline')].sort(), ['models', 'statemachine', 'store']);
  assert.deepEqual([...collectPriorSiblingModules(def, 'models')], []);
  assert.deepEqual([...collectPriorSiblingModules(def, 'main')].sort(), ['models', 'pipeline', 'statemachine', 'store']);
});

test('order-aware：允许 test_pipeline import 前序协作者 store/models（T6 真实样本）', () => {
  const dir = writeTest(
    'tests/test_pipeline.py',
    'from pipeline import import_tasks_from_csv, summarize\nfrom store import TaskStore\nfrom models import validate_task\n',
  );
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_pipeline.py',
    semantic: 'pipeline',
    sliceArtifacts: null,
    globalArtifacts: T6_GLOBAL,
  });
  assert.equal(issue, null);
});

test('order-aware：仍拦前向切片（test_store import 后续 pipeline → ImportError 风险）', () => {
  const dir = writeTest('tests/test_store.py', 'from pipeline import import_tasks_from_csv\n');
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_store.py',
    semantic: 'store',
    sliceArtifacts: null,
    globalArtifacts: T6_GLOBAL,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-slice-import-module-mismatch');
  assert.match(issue?.message ?? '', /前向切片/);
});

test('order-aware：仍拦未声明模块（防幻觉）', () => {
  const dir = writeTest('tests/test_pipeline.py', 'from nonexistent_mod import X\n');
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_pipeline.py',
    semantic: 'pipeline',
    sliceArtifacts: null,
    globalArtifacts: T6_GLOBAL,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-slice-import-module-mismatch');
  assert.match(issue?.message ?? '', /未声明模块/);
});

test('order-aware：仍拦 from __init__ import', () => {
  const dir = writeTest('tests/test_pipeline.py', 'from __init__ import summarize\n');
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_pipeline.py',
    semantic: 'pipeline',
    sliceArtifacts: null,
    globalArtifacts: T6_GLOBAL,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-slice-import-module-mismatch');
  assert.match(issue?.message ?? '', /__init__/);
});

test('order-aware：前序协作者的未声明符号仍拦', () => {
  const dir = writeTest('tests/test_pipeline.py', 'from store import bogus_helper\n');
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_pipeline.py',
    semantic: 'pipeline',
    sliceArtifacts: null,
    globalArtifacts: T6_GLOBAL,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-module-contract-violation');
  assert.equal(issue?.symbol, 'bogus_helper');
});

test('order-aware：显式 workflow 构建序（priorSiblingModules）优先于声明顺序', () => {
  const dir = writeTest('tests/test_pipeline.py', 'from store import TaskStore\n');
  // 即使 global 未声明 store 前序，显式 workflow 序提供 store 为前序 → 允许
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: 'tests/test_pipeline.py',
    semantic: 'pipeline',
    sliceArtifacts: null,
    globalArtifacts: { version: 1, files: [], modules: [{ name: 'store', exports: ['TaskStore'] }, { name: 'pipeline', exports: ['import_tasks_from_csv'] }] },
    priorSiblingModules: new Set(['models', 'store', 'statemachine']),
  });
  assert.equal(issue, null);
});

test('lintTestImportsAgainstModuleContract passes declared symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-contract-'));
  const testPath = 'tests/test_signals.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, testPath), 'from signals import compute\n');
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'signals', exports: ['compute'] }],
  };
  const issue = lintTestImportsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'signals',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.equal(issue, null);
});

test('resolveModuleExports 将 main 切片误写的 mode 规范为 main（Run #38）', () => {
  const slice = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['mode'] }],
  };
  assert.deepEqual(resolveModuleExports('main', slice, null), ['main']);
});

test('lintTestPatchTargetsAgainstModuleContract blocks patch main.SimBroker（Run #38）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-contract-'));
  const testPath = 'tests/test_main.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, testPath),
    'from main import main\nfrom unittest.mock import patch\n\ndef test_x():\n    with patch("main.SimBroker"):\n        pass\n',
  );
  const artifacts = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['mode'] }],
  };
  const issue = lintTestPatchTargetsAgainstModuleContract({
    workspaceRoot: dir,
    testRelPath: testPath,
    semantic: 'main',
    sliceArtifacts: artifacts,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-test-patch-undeclared-export');
  assert.equal(issue?.symbol, 'SimBroker');
});

test('lintTestCrossModulePatchTargetsAgainstContracts blocks patch indicators.compute_indicators（Run #41）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-patch-'));
  const testPath = 'tests/test_signals.py';
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, testPath),
    'from signals import generate_signals\n\ndef test_x(mocker):\n    mocker.patch("indicators.compute_indicators", return_value=None)\n',
  );
  const instance = {
    definition: { stages: [], meta: { taskType: 'software' } },
    stageRuntimes: [
      {
        stageId: 'stage_decide_indicators',
        outputs: {
          decisionArtifacts: {
            version: 1,
            files: [],
            modules: [
              {
                name: 'indicators',
                exports: ['compute_ma', 'compute_boll', 'compute_vol', 'compute_macd', 'compute_cci'],
              },
            ],
          },
        },
      },
      {
        stageId: 'stage_decide_architecture_overview',
        outputs: {
          decisionArtifacts: {
            version: 1,
            files: [],
            modules: [{ name: 'indicators', exports: ['compute_indicators'] }],
          },
        },
      },
    ],
  } as unknown as WorkflowInstance;
  const issue = lintTestCrossModulePatchTargetsAgainstContracts({
    workspaceRoot: dir,
    testRelPath: testPath,
    instance,
  });
  assert.ok(issue);
  assert.equal(issue?.symbol, 'compute_indicators');
  assert.match(issue?.message ?? '', /compute_ma/);
});

test('lintImplExportsAgainstModuleContract tolerates main CLI entry `main` not in contract（Run #56）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-main-entry-'));
  const implPath = 'main.py';
  fs.writeFileSync(
    path.join(dir, implPath),
    'def run_trading_loop(config):\n    return None\n\n\ndef main():\n    run_trading_loop({})\n',
  );
  const slice = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['run_trading_loop'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'main',
    sliceArtifacts: slice,
    globalArtifacts: null,
  });
  assert.equal(issue, null);
});

test('lintImplExportsAgainstModuleContract：main 入口同义词可互换（契约 cli / impl run）', () => {
  // T6 sub-task 1b：decide 把 main 契约定为 cli，但 impl 写 run（约定俗成同一入口）→ 不应判缺失。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-main-cli-run-'));
  const implPath = 'main.py';
  fs.writeFileSync(
    path.join(dir, implPath),
    'def run():\n    return None\n\n\nif __name__ == "__main__":\n    run()\n',
  );
  const slice = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['cli'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'main',
    sliceArtifacts: slice,
    globalArtifacts: null,
  });
  assert.equal(issue, null);
});

test('lintImplExportsAgainstModuleContract：main 缺非入口符号仍判缺失（同义词豁免不放水）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-main-missing-real-'));
  const implPath = 'main.py';
  fs.writeFileSync(path.join(dir, implPath), 'def run():\n    return None\n');
  const slice = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['orchestrate_pipeline'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'main',
    sliceArtifacts: slice,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-impl-export-missing');
  assert.equal(issue?.symbol, 'orchestrate_pipeline');
});

test('lintImplExportsAgainstModuleContract still blocks non-entry extra export on main', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-main-extra-'));
  const implPath = 'main.py';
  fs.writeFileSync(
    path.join(dir, implPath),
    'def run_trading_loop(config):\n    return None\n\n\ndef SimBroker():\n    return None\n',
  );
  const slice = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'main', exports: ['run_trading_loop'] }],
  };
  const issue = lintImplExportsAgainstModuleContract({
    workspaceRoot: dir,
    implRelPath: implPath,
    semantic: 'main',
    sliceArtifacts: slice,
    globalArtifacts: null,
  });
  assert.ok(issue);
  assert.equal(issue?.code, 'python-impl-export-extra');
  assert.equal(issue?.symbol, 'SimBroker');
});
