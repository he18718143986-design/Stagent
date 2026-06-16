import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  resolveModuleExports,
  sanitizeCrossSliceContamination,
  sanitizeModuleExports,
} from '../commitment/decisionArtifactsSchema';
import {
  extractModuleExportsFromDecisionRecord,
  pruneExportNoise,
  synthesizeSliceDecisionArtifacts,
} from '../commitment/decisionRecordExports';
import { SLICE_MODULE_CONTRACT_SUFFIX } from '../commitment/parseDecisionArtifacts';

test('SLICE_MODULE_CONTRACT_SUFFIX 要求完整声明、勿漏（1e prevention-at-decide）', () => {
  assert.match(SLICE_MODULE_CONTRACT_SUFFIX, /完整/);
  assert.match(SLICE_MODULE_CONTRACT_SUFFIX, /勿漏/);
  assert.match(SLICE_MODULE_CONTRACT_SUFFIX, /can_transition/);
  assert.match(SLICE_MODULE_CONTRACT_SUFFIX, /不得少于/);
});

const RUN19_RECORD = `### 关键设计决策
2. **每项指标独立导出函数**：compute_ma, compute_boll, compute_vol, compute_macd, compute_cci 各司其职，信号模块按需调用。
`;

test('extractModuleExportsFromDecisionRecord reads T4 Run #19 prose exports', () => {
  const exports = extractModuleExportsFromDecisionRecord('indicators', RUN19_RECORD);
  assert.deepEqual(exports, [
    'compute_boll',
    'compute_cci',
    'compute_ma',
    'compute_macd',
    'compute_vol',
  ]);
});

test('resolveModuleExports prefers decisionRecord over global coarse exports', () => {
  const global = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'indicators', exports: ['compute'] }],
  };
  const exports = resolveModuleExports('indicators', { version: 1, files: [], modules: [] }, global, RUN19_RECORD);
  assert.ok(exports?.includes('compute_ma'));
  assert.ok(!exports?.includes('compute') || exports.length > 1);
});

// ---- T6 decide 契约污染回归（sub-task 1b）----
// 真实样本（--keep 工作区 stage_decide_pipeline 输出）：pipeline.exports 混入 store 方法名
// add/update/list_all、其它模块名 store/statemachine、models 的 validate_task、占位 DictReader。
const T6_POLLUTED_PIPELINE = [
  'add',
  'DictReader',
  'import_tasks_from_csv',
  'list_all',
  'pipeline',
  'statemachine',
  'store',
  'summarize',
  'update',
  'validate_task',
];

// stage_decide_pipeline 真实输出：四个模块同在（slice 契约自带其它模块）。
const T6_SLICE_MODULES = [
  { name: 'models', exports: ['Task', 'validate_task'] },
  { name: 'store', exports: ['TaskStore'] },
  { name: 'statemachine', exports: ['ALLOWED_TRANSITIONS', 'can_transition', 'apply_transition', 'InvalidTransition'] },
  { name: 'pipeline', exports: T6_POLLUTED_PIPELINE },
];

// 架构 decide 的干净契约（同时看见所有模块，最少串味）。
const T6_GLOBAL_MODULES = [
  { name: 'models', exports: ['Task', 'validate_task'] },
  { name: 'store', exports: ['TaskStore'] },
  { name: 'statemachine', exports: ['ALLOWED_TRANSITIONS', 'can_transition', 'apply_transition', 'InvalidTransition'] },
  { name: 'pipeline', exports: ['import_tasks_from_csv', 'summarize'] },
  { name: 'main', exports: ['run'] },
];

test('sanitizeCrossSliceContamination：污染 pipeline 契约 → 回退 global 干净列表', () => {
  const cleaned = sanitizeCrossSliceContamination(
    'pipeline',
    T6_POLLUTED_PIPELINE,
    T6_SLICE_MODULES,
    T6_GLOBAL_MODULES,
  );
  assert.deepEqual([...cleaned].sort(), ['import_tasks_from_csv', 'summarize']);
});

test('sanitizeCrossSliceContamination：无 global 兜底也剥离他模块名/他模块导出', () => {
  const cleaned = sanitizeCrossSliceContamination(
    'pipeline',
    T6_POLLUTED_PIPELINE,
    T6_SLICE_MODULES,
    undefined,
  );
  // store/statemachine（模块名）、validate_task（models 导出）、pipeline（自身名）必被剥离
  assert.ok(!cleaned.includes('store'));
  assert.ok(!cleaned.includes('statemachine'));
  assert.ok(!cleaned.includes('validate_task'));
  assert.ok(!cleaned.includes('pipeline'));
  // 合法符号保留
  assert.ok(cleaned.includes('import_tasks_from_csv'));
  assert.ok(cleaned.includes('summarize'));
});

test('sanitizeCrossSliceContamination：欠声明（slice ⊊ global）→ 回退 global 完整列表（1e / 3b run#2 statemachine）', () => {
  // 真实样本：slice decide_statemachine 只声明 InvalidTransition，global 声明完整 4 个。
  const sliceUnder = ['InvalidTransition'];
  const globalFull = ['ALLOWED_TRANSITIONS', 'can_transition', 'apply_transition', 'InvalidTransition'];
  const cleaned = sanitizeCrossSliceContamination(
    'statemachine',
    sliceUnder,
    [{ name: 'statemachine', exports: sliceUnder }],
    [{ name: 'statemachine', exports: globalFull }],
  );
  assert.deepEqual(cleaned, globalFull);
});

test('sanitizeCrossSliceContamination：替换式 refine（互不为子集）保留 slice，不被欠声明规则误伤', () => {
  // global coarse=[compute]；slice 用具体函数替换（compute ∉ slice，slice ⊄ global 且 global ⊄ slice）→ 保留 slice。
  const sliceRefined = ['compute_ma', 'compute_boll'];
  const out = sanitizeCrossSliceContamination(
    'indicators',
    sliceRefined,
    [{ name: 'indicators', exports: sliceRefined }],
    [{ name: 'indicators', exports: ['compute'] }],
  );
  assert.deepEqual(out, sliceRefined);
});

test('resolveModuleExports：欠声明 slice + 完整 global → 解析为完整集（impl 全量导出不再被 export-extra）', () => {
  const slice = { version: 1 as const, files: [], modules: [{ name: 'statemachine', exports: ['InvalidTransition'] }] };
  const global = {
    version: 1 as const,
    files: [],
    modules: [{ name: 'statemachine', exports: ['ALLOWED_TRANSITIONS', 'can_transition', 'apply_transition', 'InvalidTransition'] }],
  };
  const resolved = resolveModuleExports('statemachine', slice, global) ?? [];
  assert.deepEqual([...resolved].sort(), [
    'ALLOWED_TRANSITIONS',
    'InvalidTransition',
    'apply_transition',
    'can_transition',
  ]);
});

test('sanitizeCrossSliceContamination：未污染契约原样返回（不影响 T4/T5）', () => {
  const clean = ['compute_ma', 'compute_boll'];
  const out = sanitizeCrossSliceContamination(
    'indicators',
    clean,
    [{ name: 'indicators', exports: clean }, { name: 'signals', exports: ['generate'] }],
    undefined,
  );
  assert.deepEqual(out, clean);
});

test('resolveModuleExports：污染 slice + 干净 global → 净化为 [import_tasks_from_csv, summarize]', () => {
  const slice = { version: 1 as const, files: [], modules: T6_SLICE_MODULES };
  const global = { version: 1 as const, files: [], modules: T6_GLOBAL_MODULES };
  const exports = resolveModuleExports('pipeline', slice, global);
  assert.deepEqual(exports, ['import_tasks_from_csv', 'summarize']);
  // 关键：方法名/模块名/占位全部清除（否则 module-contract 门误导 impl → ImportError）
  for (const poison of ['add', 'update', 'list_all', 'store', 'statemachine', 'DictReader', 'validate_task', 'pipeline']) {
    assert.ok(!exports?.includes(poison), `应剥离污染符号 ${poison}`);
  }
});

test('sanitizeCrossSliceContamination：类方法过度列举（store=[TaskStore,add,...]）→ 回退 global [TaskStore]', () => {
  // 真实样本（hkTy5j run#1）：slice decide_store 把 TaskStore 的方法名也列为模块级 export。
  const pollutedStore = ['add', 'delete', 'get', 'load_json', 'next_id', 'save', 'save_json', 'TaskStore', 'update'];
  const sliceModules = [{ name: 'store', exports: pollutedStore }];
  const globalModules = [
    { name: 'store', exports: ['TaskStore'] },
    { name: 'pipeline', exports: ['import_tasks_from_csv', 'summarize'] },
  ];
  const cleaned = sanitizeCrossSliceContamination('store', pollutedStore, sliceModules, globalModules);
  assert.deepEqual(cleaned, ['TaskStore']);
});

test('sanitizeCrossSliceContamination：合法 refine（替换 coarse 符号）不被 superset 规则误伤', () => {
  // global coarse=[compute]；slice 用具体函数替换（不含 compute）→ 非 superset → 保留 slice。
  const sliceRefined = ['compute_ma', 'compute_boll', 'compute_cci'];
  const out = sanitizeCrossSliceContamination(
    'indicators',
    sliceRefined,
    [{ name: 'indicators', exports: sliceRefined }],
    [{ name: 'indicators', exports: ['compute'] }],
  );
  assert.deepEqual(out, sliceRefined);
});

test('resolveModuleExports：干净 slice 契约不受影响', () => {
  const slice = {
    version: 1 as const,
    files: [],
    modules: [
      { name: 'store', exports: ['TaskStore'] },
      { name: 'pipeline', exports: ['import_tasks_from_csv', 'summarize'] },
    ],
  };
  const global = { version: 1 as const, files: [], modules: T6_GLOBAL_MODULES };
  assert.deepEqual(resolveModuleExports('store', slice, global), ['TaskStore']);
  assert.deepEqual(resolveModuleExports('pipeline', slice, global), ['import_tasks_from_csv', 'summarize']);
});

test('sanitizeModuleExports：main 契约仅 `main`（被剔空）→ 规范为 [main]（子任务 1d）', () => {
  // 'main' 在 SKIP_IDENT 中被 pruneExportNoise 剔除 → 旧逻辑返回 []（无契约指引）。
  assert.deepEqual(sanitizeModuleExports('main', ['main']), ['main']);
  // 非 main 切片不受影响（被剔空仍为空）。
  assert.deepEqual(sanitizeModuleExports('store', ['main']), []);
});

test('resolveModuleExports：main 仅声明 `main` → 解析为 [main]（供 prompt/门/stub）', () => {
  const slice = { version: 1 as const, files: [], modules: [{ name: 'main', exports: ['main'] }] };
  assert.deepEqual(resolveModuleExports('main', slice, null), ['main']);
});

test('synthesizeSliceDecisionArtifacts builds modules[] when sidecar missing', () => {
  const artifacts = synthesizeSliceDecisionArtifacts('indicators', RUN19_RECORD, null);
  assert.equal(artifacts?.modules?.length, 1);
  assert.deepEqual(artifacts?.modules?.[0]?.name, 'indicators');
  assert.ok(artifacts?.modules?.[0]?.exports.includes('compute_ma'));
});

test('extractModuleExportsFromDecisionRecord ignores int(0~3) type noise (Run #21 signals)', () => {
  const record = [
    '主方法 `generate` 组合结果。',
    "strength':int(0~3), timestamp:str",
    '采用统一字典 `SignalInput`',
  ].join('\n');
  const exports = extractModuleExportsFromDecisionRecord('signals', record);
  assert.ok(exports?.includes('generate'));
  assert.ok(!exports?.includes('int'));
  assert.ok(!exports?.includes('str'));
  assert.ok(!exports?.includes('SignalInput'));
});

const RUN44_INDICATORS_RECORD = `五个公开函数为 \`calculate_ma\`, \`calculate_boll\`, \`calculate_vol\`, \`calculate_macd\`, \`calculate_cci\`，内部辅助函数不得被外部导入。
- **纯函数返回新列而非原地修改**：由调用方选择 \`df.assign()\` 或 \`pd.concat\`。
- 引发 \`ValueError\` 或返回空 DataFrame。
- 抛出 \`KeyError\`。
- 均线用 \`rolling().mean()\`，布林带用 \`rolling().std()\`。
- 函数按指标独立拆分，而非合并为 \`compute_all\`。
`;

test('extractModuleExportsFromDecisionRecord prefers explicit 五个公开函数 list (Run #44)', () => {
  const exports = extractModuleExportsFromDecisionRecord('indicators', RUN44_INDICATORS_RECORD);
  assert.deepEqual(exports, [
    'calculate_boll',
    'calculate_cci',
    'calculate_ma',
    'calculate_macd',
    'calculate_vol',
  ]);
});

test('pruneExportNoise strips index_sh/index_sz market globals（Run #51）', () => {
  const cleaned = pruneExportNoise([
    'generate_long_signal',
    'generate_short_signal',
    'index_sh',
    'index_sz',
  ]);
  assert.deepEqual(cleaned, ['generate_long_signal', 'generate_short_signal']);
});

test('pruneExportNoise strips KeyError/assign from polluted artifacts list', () => {
  const cleaned = pruneExportNoise([
    'assign',
    'calculate_ma',
    'KeyError',
    'rolling',
    'calculate_boll',
  ]);
  assert.deepEqual(cleaned, ['calculate_boll', 'calculate_ma']);
});

test('sanitizeModuleExports prunes noise from stored sidecar exports', () => {
  const cleaned = sanitizeModuleExports('indicators', [
    'assign',
    'calculate_ma',
    'KeyError',
    'calculate_boll',
  ]);
  assert.deepEqual(cleaned, ['calculate_boll', 'calculate_ma']);
});

test('synthesizeSliceDecisionArtifacts replaces weak int-only exports', () => {
  const record = '主方法 `generate` 组合结果。';
  const artifacts = synthesizeSliceDecisionArtifacts('signals', record, {
    version: 1,
    files: [],
    modules: [{ name: 'signals', exports: ['int'] }],
  });
  assert.deepEqual(artifacts?.modules?.[0]?.exports, ['generate']);
});

const RUN59_BROKER_RECORD = `broker模块负责与外部交易/行情系统交互。提供抽象基类BrokerAdapter定义下单、查询持仓、查询行情接口；SimBroker为模拟适配器，使用本地CSV/内存数据模拟实盘行为。
- 当行情CSV中某条记录的K线时间戳缺失/非法时，SimBroker.query_market()抛出异常并记录错误日志。
- 假设CSV文件列名固定且顺序为：datetime, open, high, low, close, volume。`;

test('pruneExportNoise strips Python builtin functions max/len/sorted（T6 batch2 run3 store max）', () => {
  // decide 正文「取最大 id+1」「列表长度」等 → max/len/sorted 被误抽为 export；它们是内建非模块 API。
  const cleaned = pruneExportNoise(['TaskStore', 'add', 'get', 'max', 'len', 'sorted', 'list_all']);
  assert.deepEqual(cleaned, ['add', 'get', 'list_all', 'TaskStore']);
});

test('pruneExportNoise strips datetime stdlib from export list（Run #59）', () => {
  const cleaned = pruneExportNoise(['BrokerAdapter', 'SimBroker', 'datetime']);
  assert.deepEqual(cleaned, ['BrokerAdapter', 'SimBroker']);
});

test('pruneExportNoise strips library display names NumPy/Pandas（Run #66b indicators）', () => {
  // 真实 decide_indicators 合成 exports：5 个 calc_* + 库名 NumPy → impl 误拦根因
  const cleaned = pruneExportNoise([
    'calc_boll',
    'calc_cci',
    'calc_ma',
    'calc_macd',
    'calc_vol',
    'NumPy',
  ]);
  assert.deepEqual(cleaned, ['calc_boll', 'calc_cci', 'calc_ma', 'calc_macd', 'calc_vol']);
  // 其它库展示名（import 根名或展示名）同样剔除，但真实领域类名保留
  assert.deepEqual(pruneExportNoise(['Pandas', 'PyYAML', 'requests', 'SimBroker']), ['SimBroker']);
});

test('pruneExportNoise strips typing/dataclass primitives NamedTuple/dataclass（Run #66c signals）', () => {
  // 真实 decide_signals 合成 exports：函数+条件名 + 类型原语 NamedTuple → impl 误拦根因
  const cleaned = pruneExportNoise([
    'generate_long_signal',
    'generate_short_signal',
    'ma_convergence',
    'NamedTuple',
  ]);
  assert.deepEqual(cleaned, ['generate_long_signal', 'generate_short_signal', 'ma_convergence']);
  // 其它 typing/dataclasses/enum 原语同样剔除，真实领域符号保留
  assert.deepEqual(
    pruneExportNoise(['TypedDict', 'dataclass', 'Protocol', 'Enum', 'RiskManager']),
    ['RiskManager'],
  );
});

test('extractModuleExportsFromDecisionRecord ignores CSV columns and instance methods（Run #59 broker）', () => {
  const exports = extractModuleExportsFromDecisionRecord('broker', RUN59_BROKER_RECORD);
  assert.deepEqual(exports, ['BrokerAdapter', 'SimBroker']);
});

test('synthesizeSliceDecisionArtifacts replaces misleading datetime/query_market sidecar（Run #59）', () => {
  const artifacts = synthesizeSliceDecisionArtifacts('broker', RUN59_BROKER_RECORD, {
    version: 1,
    files: [],
    modules: [{ name: 'broker', exports: ['datetime', 'query_market'] }],
  });
  assert.deepEqual(artifacts?.modules?.[0]?.exports, ['BrokerAdapter', 'SimBroker']);
});

const RUN60_INDICATORS_RECORD = `### 关键设计决策
1. **函数签名与返回结构**
   - \`compute_ma\`：返回追加 \`ma5\`/\`ma6\`/\`ma7\`/\`ma8\`/\`ma9\`/\`ma11\`/\`ma20\` 列的 DataFrame。
   - \`compute_boll\`：返回 \`boll_mid\`/\`boll_upper\`/\`boll_lower\` 列。
   - \`compute_vol\`：返回 \`volume\`/\`vol_ma3\`/\`vol_ma100\` 列。
   - \`compute_macd\`：返回 \`dif\`/\`dea\`/\`hist\` 列。
   - \`compute_cci\`：返回 \`cci\` Series。
3. **NaN 传播** 当数据长度不足时，对应位置填充 NaN。`;

test('pruneExportNoise strips indicator DataFrame column names（Run #60）', () => {
  const cleaned = pruneExportNoise([
    'compute_ma',
    'compute_boll',
    'boll_lower',
    'ma5',
    'NaN',
    'dif',
    'cci',
  ]);
  assert.deepEqual(cleaned, ['compute_boll', 'compute_ma']);
});

test('extractModuleExportsFromDecisionRecord keeps compute_* only for indicators（Run #60）', () => {
  const exports = extractModuleExportsFromDecisionRecord('indicators', RUN60_INDICATORS_RECORD);
  assert.deepEqual(exports, [
    'compute_boll',
    'compute_cci',
    'compute_ma',
    'compute_macd',
    'compute_vol',
  ]);
});

test('synthesizeSliceDecisionArtifacts prunes column-only polluted sidecar（Run #60）', () => {
  const polluted = [
    'boll_lower',
    'boll_mid',
    'boll_upper',
    'cci',
    'compute_boll',
    'compute_cci',
    'compute_ma',
    'compute_macd',
    'compute_vol',
    'dea',
    'dif',
    'hist',
    'ma11',
    'ma20',
    'ma5',
    'NaN',
    'vol_ma100',
    'vol_ma3',
  ];
  const artifacts = synthesizeSliceDecisionArtifacts('indicators', RUN60_INDICATORS_RECORD, {
    version: 1,
    files: [],
    modules: [{ name: 'indicators', exports: polluted }],
  });
  assert.deepEqual(artifacts?.modules?.[0]?.exports, [
    'compute_boll',
    'compute_cci',
    'compute_ma',
    'compute_macd',
    'compute_vol',
  ]);
});
