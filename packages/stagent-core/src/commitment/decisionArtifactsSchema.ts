import { extractModuleExportsFromDecisionRecord, pruneExportNoise } from './decisionRecordExports';
import type { BehaviorSpecV1 } from './behaviorSpecSchema';
import { filterBlockedPipDependencies } from '../python-contract/blockedPipDependencies';
import { isPythonStdlibRoot } from '../python-contract/pythonStdlibRoots';

export interface DecisionArtifactFileV1 {
  key: string;
  path: string;
  format: string;
  content: string;
}

/** TDD / 量化基线依赖（与 stage_ensure_requirements_baseline 对齐）。 */
export const PYTHON_BASELINE_DEPENDENCIES = ['pytest', 'numpy', 'pandas'] as const;

/**
 * PyPI 包名 → import 根名别名（lint 与 prompt SSOT 共用）。
 * 例：pyyaml 已声明时 `import yaml` 合法。
 */
export const DEPENDENCY_IMPORT_ROOT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pyyaml: ['yaml'],
};

/** decisionArtifacts.files 含 YAML 落盘路径时隐式允许的包（T4 config.yaml 场景）。 */
export function inferImplicitDependenciesFromArtifacts(
  artifacts: DecisionArtifactsV1 | null | undefined,
): string[] {
  if (!artifacts?.files?.length) {
    return [];
  }
  const implicit = new Set<string>();
  for (const f of artifacts.files) {
    const p = (f.path ?? '').trim().toLowerCase();
    if (p.endsWith('.yaml') || p.endsWith('.yml')) {
      // pip 包名是 pyyaml；`import yaml` 由 isDeclaredImportRoot 别名处理，不得写入 requirements.txt
      implicit.add('pyyaml');
    }
  }
  return [...implicit];
}

/** import 根名是否在已声明依赖集合内（含别名）。 */
export function isDeclaredImportRoot(importRoot: string, allowedDeps: Iterable<string>): boolean {
  const root = importRoot.toLowerCase();
  const allowed = new Set([...allowedDeps].map((d) => d.toLowerCase()));
  if (allowed.has(root)) {
    return true;
  }
  for (const [pkg, aliases] of Object.entries(DEPENDENCY_IMPORT_ROOT_ALIASES)) {
    if (allowed.has(pkg) && aliases.includes(root)) {
      return true;
    }
  }
  return false;
}

export interface DecisionArtifactsV1 {
  version: 1;
  files: DecisionArtifactFileV1[];
  modules?: Array<{ name: string; exports: string[] }>;
  /** 允许 impl/fix 引用的第三方包根名（不含版本 pin）。 */
  dependencies?: string[];
  testStack?: 'pytest' | 'jest' | 'vitest';
  /** 行为规格 SSOT（首期 signals 必填；见 behaviorSpecSchema.ts）。 */
  behaviorSpec?: BehaviorSpecV1;
}

export function isDecisionArtifactsV1(value: unknown): value is DecisionArtifactsV1 {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as DecisionArtifactsV1;
  return o.version === 1 && Array.isArray(o.files);
}

export function normalizeModuleExports(
  modules: Array<{ name: string; exports: string[] }> | undefined,
): Array<{ name: string; exports: string[] }> {
  if (!modules?.length) {
    return [];
  }
  return modules
    .filter((m) => typeof m.name === 'string' && m.name.trim())
    .map((m) => ({
      name: m.name.trim(),
      exports: [
        ...new Set(
          (m.exports ?? [])
            .map((e) => (typeof e === 'string' ? e.trim() : ''))
            .filter(Boolean),
        ),
      ],
    }));
}

/**
 * 纠正常见 LLM 误写（T4 Run #38：main 切片 export=mode 实为 CLI --mode 参数名）。
 * 仅在入口模块且 exports 为单一可疑符号时替换，避免误伤合法命名。
 */
export function sanitizeModuleExports(semantic: string, exports: string[]): string[] {
  const cleaned = pruneExportNoise(exports);
  if (semantic === 'main' && cleaned.length === 1 && cleaned[0] === 'mode') {
    return ['main'];
  }
  // 子任务 1d：main 切片入口名（`main` 在 SKIP_IDENT、或被当噪声）常被 pruneExportNoise 剔空，
  // 但 main 是程序入口、契约不应为空——剔空时默认规范为入口函数 `main`，
  // 使 prompt（契约指引）、module-contract 门、stub 物化三处都有据，避免「无指引→模型自造入口名(run_cli)」。
  if (semantic === 'main' && cleaned.length === 0 && exports.length > 0) {
    return ['main'];
  }
  return cleaned;
}

/** 收集除 `semantic` 外其它模块的「模块名」与「声明导出符号」（跨切片归属判据）。 */
function collectOtherModuleSymbols(
  modules: Array<{ name: string; exports: string[] }> | undefined,
  semantic: string,
): { names: Set<string>; exports: Set<string> } {
  const names = new Set<string>();
  const exportsSet = new Set<string>();
  for (const m of normalizeModuleExports(modules)) {
    if (m.name === semantic) {
      continue;
    }
    names.add(m.name);
    for (const e of m.exports) {
      exportsSet.add(e);
    }
  }
  return { names, exports: exportsSet };
}

/**
 * 跨切片契约污染净化（prevention-at-decide / ADR-0007 module-exports 篇）。
 *
 * 现象（T6 决定性回归，flash 与 pro 同样命中）：`stage_decide_pipeline` 把 store 的方法名
 * （add/update/list_all）、其它模块名（store/statemachine）、models 的 `validate_task`、占位
 * `DictReader` 全塞进 `pipeline.exports`。污染契约**反过来误导 impl** 写出 `from . import store`
 * → 真实 ImportError，module-contract 门正确判红 → T6 卡在 smoke 之前。
 *
 * 判据（确定性，纯函数）：某模块 M 的 slice 契约导出若混入「另一模块的名字」或「另一模块声明的
 * 导出符号」或「M 自身的模块名」，即判为被污染（合法 refine 不会列入他模块的名字/导出）。
 * 净化策略：
 *   1) **优先用 global 架构契约**——global decide 同时看见所有模块、最少跨切片串味，其 M 列表是
 *      干净权威；被污染时回退到 global 的 M 列表（彻底清除方法名/占位等纯幻觉符号）。
 *   2) global 无 M 列表时，**剥离**可判定的污染符号（他模块名/他模块导出/自身模块名）。
 * 未被污染的契约**原样返回**，不影响既有任务（T4/T5）。
 */
export function sanitizeCrossSliceContamination(
  semantic: string,
  sliceExports: string[],
  sliceModules: Array<{ name: string; exports: string[] }> | undefined,
  globalModules: Array<{ name: string; exports: string[] }> | undefined,
): string[] {
  const fromSlice = collectOtherModuleSymbols(sliceModules, semantic);
  const fromGlobal = collectOtherModuleSymbols(globalModules, semantic);
  const otherNames = new Set([...fromSlice.names, ...fromGlobal.names]);
  const otherExports = new Set([...fromSlice.exports, ...fromGlobal.exports]);
  const isContaminant = (s: string): boolean =>
    otherNames.has(s) || otherExports.has(s) || s === semantic;
  const crossSliceContaminated = sliceExports.some(isContaminant);

  // 与 global 架构契约对账（global 同时看见所有模块，是干净的跨切片权威）。两类偏差都回退 global：
  //  - **过度列举**（1b）：slice ⊇ global 且有额外项（如 store=[TaskStore,add,get,...]，global=[TaskStore]）——
  //    类方法/占位被误列；合法 refine 是「替换」coarse 符号，不会保留 global 全部再加项。
  //  - **欠声明**（1e，3b run#2 发现）：slice ⊊ global，漏掉 global 已声明的真实导出
  //    （如 statemachine slice=[InvalidTransition]，global=[ALLOWED_TRANSITIONS,can_transition,
  //    apply_transition,InvalidTransition]）——impl 正确导出全集反被 export-extra 判红。
  // 二者皆「slice 与 global 互为子集且不相等」；「替换式 refine」（双方各有独有符号、互不为子集）不触发，保留 slice。
  const globalEntry = normalizeModuleExports(globalModules).find((m) => m.name === semantic);
  const globalExports = globalEntry?.exports ?? [];
  const globalSet = new Set(globalExports);
  const sliceSet = new Set(sliceExports);
  const overListsGlobal =
    globalExports.length > 0 &&
    sliceExports.length > globalExports.length &&
    globalExports.every((g) => sliceSet.has(g));
  const underDeclaresGlobal =
    globalExports.length > 0 &&
    sliceExports.length < globalExports.length &&
    sliceExports.every((s) => globalSet.has(s));

  if (!crossSliceContaminated && !overListsGlobal && !underDeclaresGlobal) {
    return sliceExports;
  }
  // 偏差：优先回退到 global 的完整/干净 M 列表（补全欠声明、清除过度列举/污染）。
  if (globalExports.length > 0) {
    return globalExports;
  }
  // 无 global 兜底：剥离可判定的污染符号（他模块名/他模块导出/自身模块名）。
  return sliceExports.filter((s) => !isContaminant(s));
}

/** slice sidecar → slice decisionRecord 正文 → global architecture modules[]。 */
export function resolveModuleExports(
  semantic: string,
  sliceArtifacts: DecisionArtifactsV1 | null | undefined,
  globalArtifacts: DecisionArtifactsV1 | null | undefined,
  sliceDecisionRecord?: string | null,
): string[] | null {
  // 子任务 1d：main 切片入口名（`main`/被净化剔空/被当自身名污染剔除）常使解析结果为空，
  // 但 main 是程序入口、契约不应为空——任一来源**声明过** main 后若解析为空，默认规范为 [main]，
  // 使 prompt（契约指引）/module-contract 门/stub 物化都有据，避免「无指引→模型自造入口名」。
  const mainEntryFallback = (resolved: string[] | null, declaredNonEmpty: boolean): string[] | null => {
    if (semantic === 'main' && declaredNonEmpty && (!resolved || resolved.length === 0)) {
      return ['main'];
    }
    return resolved;
  };

  const sliceEntry = normalizeModuleExports(sliceArtifacts?.modules).find((m) => m.name === semantic);
  if (sliceEntry && sliceEntry.exports.length > 0) {
    const decontaminated = sanitizeCrossSliceContamination(
      semantic,
      sliceEntry.exports,
      sliceArtifacts?.modules,
      globalArtifacts?.modules,
    );
    return mainEntryFallback(sanitizeModuleExports(semantic, decontaminated), true);
  }
  if (sliceDecisionRecord?.trim()) {
    const fromRecord = extractModuleExportsFromDecisionRecord(semantic, sliceDecisionRecord);
    if (fromRecord?.length) {
      return fromRecord;
    }
  }
  const globalEntry = normalizeModuleExports(globalArtifacts?.modules).find((m) => m.name === semantic);
  if (globalEntry && globalEntry.exports.length > 0) {
    return mainEntryFallback(sanitizeModuleExports(semantic, globalEntry.exports), true);
  }
  return null;
}

export function normalizeDependencies(deps: string[] | undefined): string[] {
  if (!deps?.length) {
    return [];
  }
  return [
    ...new Set(
      deps
        .map((d) => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
        .filter(Boolean),
    ),
  ];
}

/** 合并 global + 全部 slice decisionArtifacts.dependencies，并含基线包。 */
export function resolveDeclaredDependencies(
  sliceArtifacts: DecisionArtifactsV1 | null | undefined,
  globalArtifacts: DecisionArtifactsV1 | null | undefined,
): string[] {
  const merged = new Set<string>(PYTHON_BASELINE_DEPENDENCIES);
  for (const dep of normalizeDependencies(globalArtifacts?.dependencies)) {
    merged.add(dep);
  }
  for (const dep of normalizeDependencies(sliceArtifacts?.dependencies)) {
    merged.add(dep);
  }
  return [...merged];
}

/** 从 workflow instance 收集全部已声明第三方依赖（global + 各 slice decide + 隐式推断）。 */
export function collectDeclaredDependenciesFromInstance(
  stageRuntimes: Array<{ stageId: string; outputs?: Record<string, unknown> }>,
  decisionArtifactsKey: string,
): string[] {
  const merged = new Set<string>(PYTHON_BASELINE_DEPENDENCIES);
  for (const rt of stageRuntimes) {
    if (!rt.stageId.startsWith('stage_decide_')) {
      continue;
    }
    const raw = rt.outputs?.[decisionArtifactsKey];
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const artifacts = raw as DecisionArtifactsV1;
    for (const dep of normalizeDependencies(artifacts.dependencies)) {
      merged.add(dep);
    }
    for (const dep of inferImplicitDependenciesFromArtifacts(artifacts)) {
      merged.add(dep);
    }
  }
  // 标准库模块（csv/json/datetime/dataclasses/enum…）不是 pip 包，模型常误列为依赖 →
  // 写入 requirements.txt 后 pip install 失败（T6 run8：`csv`）。stdlib 一律剔除。
  return filterBlockedPipDependencies(merged).filter((dep) => !isPythonStdlibRoot(dep));
}

/** import 根名别名（如 yaml）→ 排除；仅保留可 pip install 的包名。 */
export function toPipInstallableDependencies(deps: Iterable<string>): string[] {
  const aliasImportRoots = new Set(
    Object.values(DEPENDENCY_IMPORT_ROOT_ALIASES).flatMap((aliases) => aliases.map((a) => a.toLowerCase())),
  );
  const out = new Set<string>();
  for (const dep of deps) {
    const pkg = dep.trim().toLowerCase();
    if (!pkg || aliasImportRoots.has(pkg) || isPythonStdlibRoot(pkg)) {
      continue;
    }
    out.add(pkg);
  }
  return [...out];
}

/** 运行时注入 test_write / impl / fix：已声明第三方依赖 SSOT。 */
export function buildDeclaredDependenciesPromptSuffix(
  stageRuntimes: Array<{ stageId: string; outputs?: Record<string, unknown> }>,
  decisionArtifactsKey: string,
): string | undefined {
  const deps = collectDeclaredDependenciesFromInstance(stageRuntimes, decisionArtifactsKey);
  if (deps.length === 0) {
    return undefined;
  }
  return [
    '【已声明第三方依赖 SSOT（decisionArtifacts.dependencies + 基线 + 隐式推断）】',
    '仅可 import 下列第三方包（以及 Python 标准库、项目内模块）：',
    ...deps.map((d) => `- ${d}`),
    '未列出的第三方包禁止 import；需要 YAML 解析且列表含 pyyaml 时使用 `import yaml`。',
  ].join('\n');
}

/** 从 modules[] 收集项目内包名（用于 declared-deps lint 跳过）。 */
export function collectProjectModuleNames(
  sliceArtifacts: DecisionArtifactsV1 | null | undefined,
  globalArtifacts: DecisionArtifactsV1 | null | undefined,
): string[] {
  const names = new Set<string>();
  for (const m of normalizeModuleExports(globalArtifacts?.modules)) {
    names.add(m.name);
  }
  for (const m of normalizeModuleExports(sliceArtifacts?.modules)) {
    names.add(m.name);
  }
  return [...names];
}

/**
 * 收集 instance 全部 decide 阶段中、**排除某切片**的模块导出符号集合。
 * 用于集成切片（main）export-missing 豁免：decide 常把它编排的下游切片函数误列进 main 契约，
 * 但 main 是 orchestrator，不应被要求导出下游符号（T6 run6/batch3：main 契约含 import_tasks_from_csv）。
 */
export function collectSliceExportSymbolsFromInstance(
  stageRuntimes: Array<{ stageId: string; outputs?: Record<string, unknown> }>,
  decisionArtifactsKey: string,
  excludeSemantic: string,
): Set<string> {
  const symbols = new Set<string>();
  for (const rt of stageRuntimes) {
    if (!rt.stageId.startsWith('stage_decide_')) {
      continue;
    }
    const raw = rt.outputs?.[decisionArtifactsKey];
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    for (const m of normalizeModuleExports((raw as DecisionArtifactsV1).modules)) {
      if (m.name === excludeSemantic) {
        continue;
      }
      for (const e of m.exports ?? []) {
        const s = e.trim();
        if (s) {
          symbols.add(s);
        }
      }
    }
  }
  return symbols;
}

/** 从 instance 全部 decide 阶段收集项目内模块名。 */
export function collectAllProjectModuleNamesFromInstance(
  stageRuntimes: Array<{ stageId: string; outputs?: Record<string, unknown> }>,
  decisionArtifactsKey: string,
): string[] {
  const names = new Set<string>();
  for (const rt of stageRuntimes) {
    if (!rt.stageId.startsWith('stage_decide_')) {
      continue;
    }
    const raw = rt.outputs?.[decisionArtifactsKey];
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    for (const m of normalizeModuleExports((raw as DecisionArtifactsV1).modules)) {
      names.add(m.name);
    }
  }
  return [...names];
}
