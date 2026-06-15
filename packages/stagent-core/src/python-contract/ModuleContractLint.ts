import * as fs from 'fs';
import * as path from 'path';
import {
  type DecisionArtifactsV1,
  isDecisionArtifactsV1,
  normalizeModuleExports,
  resolveModuleExports,
} from '../commitment/decisionArtifactsSchema';
import type { WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import { isImplStageId, semanticNameFromImplStageId } from '../workflow/StageIdPatterns';
import {
  extractExportedSymbols,
  extractModuleLevelConstants,
  extractImportedNames,
  parsePythonFromImports,
} from './PythonExportContractLint';
import { isExternalPythonModuleRoot } from './pythonExternalModules';
import { resolveSliceArtifacts } from './sliceContractGateHelpers';

export type ModuleContractIssueCode =
  | 'python-module-contract-violation'
  | 'python-test-slice-import-module-mismatch'
  | 'python-test-patch-undeclared-export'
  | 'module-contract-missing'
  | 'python-impl-export-missing'
  | 'python-impl-export-extra';

const PATCH_TARGET_RE = /(?:@patch|patch|mocker\.patch)\s*\(\s*['"]([^'"]+)['"]/g;

const PROJECT_SLICE_MODULE_NAMES = new Set([
  'indicators',
  'signals',
  'risk',
  'broker',
  'main',
]);

const FORBIDDEN_SLICE_TEST_MODULE_NAMES = new Set(['__init__']);

/**
 * main 切片为 CLI/集成入口（需求 `main/cli`）：`main` / `run` / `cli` 是约定俗成的公开入口符号，
 * 即使 decide 契约只声明其一（如 run_trading_loop），impl 同时导出入口函数也不应判为 export-extra。
 * T4 Run #56：契约 exports=[run_trading_loop]，impl 合理导出 `main` 被误拦。
 */
const MAIN_ENTRY_CONVENTIONAL_EXPORTS = new Set(['main', 'run', 'cli']);

export interface ModuleContractIssue {
  code: ModuleContractIssueCode;
  message: string;
  module: string;
  symbol: string;
  testFile: string;
  contractSource?: 'slice' | 'global';
}

export function coerceDecisionArtifacts(value: unknown): DecisionArtifactsV1 | null {
  return isDecisionArtifactsV1(value) ? value : null;
}

/** 全部已声明的项目模块名（global + slice decisionArtifacts.modules）。 */
function collectDeclaredModuleNames(
  sliceArtifacts: DecisionArtifactsV1 | null | undefined,
  globalArtifacts: DecisionArtifactsV1 | null | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const m of normalizeModuleExports(globalArtifacts?.modules)) {
    names.add(m.name);
  }
  for (const m of normalizeModuleExports(sliceArtifacts?.modules)) {
    names.add(m.name);
  }
  return names;
}

/**
 * 工作流真实「构建序」：按 `stage_impl_<semantic>` 落盘顺序（排除 bundle-write / conftest），
 * 这是 per-slice test_run 时哪些兄弟切片已落盘的权威来源（决定 import 是否会 ImportError）。
 */
export function collectSliceBuildOrder(definition: WorkflowDefinition | undefined): string[] {
  const order: string[] = [];
  for (const s of definition?.stages ?? []) {
    if (!isImplStageId(s.id) || s.id.endsWith('_stagent_bundle_write')) {
      continue;
    }
    const sem = semanticNameFromImplStageId(s.id);
    if (sem && sem !== 'conftest' && !order.includes(sem)) {
      order.push(sem);
    }
  }
  return order;
}

/** semantic 之前已落盘的兄弟切片集合（真实协作者）。 */
export function collectPriorSiblingModules(
  definition: WorkflowDefinition | undefined,
  semantic: string,
): Set<string> {
  const order = collectSliceBuildOrder(definition);
  const idx = order.indexOf(semantic);
  if (idx <= 0) {
    return new Set();
  }
  return new Set(order.slice(0, idx));
}

/**
 * order-aware 判定：modRoot 是否为「semantic 的合法前序协作者」——已声明的项目模块、且构建序在
 * semantic **之前**（已落盘，import 不会 ImportError）。优先用工作流构建序（authoritative），
 * 缺省回退 global decisionArtifacts.modules 的声明顺序。
 */
function resolvePriorSiblingModules(
  semantic: string,
  sliceArtifacts: DecisionArtifactsV1 | null | undefined,
  globalArtifacts: DecisionArtifactsV1 | null | undefined,
  explicit?: ReadonlySet<string>,
): ReadonlySet<string> {
  if (explicit) {
    return explicit;
  }
  // 回退：global 声明顺序（架构 decide 通常按依赖/构建序列出 modules）。
  const ordered = normalizeModuleExports(globalArtifacts?.modules).map((m) => m.name);
  const idx = ordered.indexOf(semantic);
  if (idx > 0) {
    return new Set(ordered.slice(0, idx));
  }
  return new Set();
}

export function lintTestImportsAgainstModuleContract(params: {
  workspaceRoot: string;
  testRelPath: string;
  semantic: string;
  sliceArtifacts: DecisionArtifactsV1 | null | undefined;
  globalArtifacts: DecisionArtifactsV1 | null | undefined;
  sliceDecisionRecord?: string | null;
  /** 已落盘前序兄弟切片（构建序在 semantic 之前）；缺省回退 global modules 声明顺序。 */
  priorSiblingModules?: ReadonlySet<string>;
}): ModuleContractIssue | null {
  const { workspaceRoot, testRelPath, semantic, sliceArtifacts, globalArtifacts, sliceDecisionRecord } =
    params;
  const exports = resolveModuleExports(
    semantic,
    sliceArtifacts,
    globalArtifacts,
    sliceDecisionRecord,
  );
  if (!exports) {
    return {
      code: 'module-contract-missing',
      message: `module-contract：切片 ${semantic} 无 decisionArtifacts.modules 契约（slice 与 global 均未声明 exports）`,
      module: semantic,
      symbol: '*',
      testFile: testRelPath,
    };
  }

  const exportSet = new Set(exports);
  const abs = path.isAbsolute(testRelPath)
    ? testRelPath
    : path.join(workspaceRoot, testRelPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const content = fs.readFileSync(abs, 'utf8');
  const sliceEntry = sliceArtifacts?.modules?.find((m) => m.name === semantic);
  const contractSource =
    sliceEntry && (sliceEntry.exports?.length ?? 0) > 0 ? 'slice' : 'global';
  const declaredModules = collectDeclaredModuleNames(sliceArtifacts, globalArtifacts);
  const priorSiblings = resolvePriorSiblingModules(
    semantic,
    sliceArtifacts,
    globalArtifacts,
    params.priorSiblingModules,
  );

  for (const imp of parsePythonFromImports(content)) {
    const modRoot = imp.module.split('.')[0]!;
    if (isExternalPythonModuleRoot(modRoot)) {
      continue;
    }
    if (modRoot !== semantic) {
      // order-aware 调和（ADR-0008/0009「测真实协作者」）：允许 import 已声明且**构建序在前**的
      // 兄弟切片（已落盘，不会 ImportError）；仍拦 __init__ / 未声明模块 / 前向（未落盘）切片。
      const isForbiddenName = FORBIDDEN_SLICE_TEST_MODULE_NAMES.has(modRoot);
      if (!isForbiddenName && declaredModules.has(modRoot) && priorSiblings.has(modRoot)) {
        // 校验导入符号在该前序协作者契约 exports 中（防幻觉符号）。
        const collaboratorExports = resolveModuleExports(modRoot, null, globalArtifacts);
        const collaboratorSet = new Set(collaboratorExports ?? []);
        for (const name of imp.names) {
          if (
            name === '*' ||
            collaboratorSet.size === 0 ||
            collaboratorSet.has(name) ||
            (modRoot === 'main' && MAIN_ENTRY_CONVENTIONAL_EXPORTS.has(name))
          ) {
            continue;
          }
          return {
            code: 'python-module-contract-violation',
            message: `module-contract：${testRelPath} 从前序协作者 ${modRoot} import ${name}，但 ${modRoot} 契约 exports 未声明该符号（允许：${[...collaboratorSet].join(', ') || '（空）'}）`,
            module: modRoot,
            symbol: name,
            testFile: testRelPath,
            contractSource,
          };
        }
        continue;
      }
      const hint = isForbiddenName
        ? `impl 落在 ${semantic}/__init__.py 时，测试仍须写 from ${semantic} import，不能写 from __init__ import`
        : declaredModules.has(modRoot)
          ? `${modRoot} 是尚未落盘的前向切片（构建序不在 ${semantic} 之前），per-slice test_run 会 ImportError；只能 import 真实前序协作者切片`
          : `切片 ${semantic} 的测试须写 from ${semantic} import（或已声明且前序落盘的协作者切片），不得 import 未声明模块 ${modRoot}`;
      return {
        code: 'python-test-slice-import-module-mismatch',
        message: `module-contract：${testRelPath} 使用 from ${modRoot} import，${hint}`,
        module: modRoot,
        symbol: imp.names[0] ?? '*',
        testFile: testRelPath,
        contractSource,
      };
    }
    for (const name of imp.names) {
      if (name === '*' || exportSet.has(name)) {
        continue;
      }
      // 集成切片 main 的约定入口符号（main/run/cli）即使 decide 契约漏声明也允许测试导入，
      // 与 export-extra 侧的 MAIN_ENTRY_CONVENTIONAL_EXPORTS 放行对称（T6 测试 `from main import main`）。
      if (semantic === 'main' && MAIN_ENTRY_CONVENTIONAL_EXPORTS.has(name)) {
        continue;
      }
      return {
        code: 'python-module-contract-violation',
        message: `module-contract：${testRelPath} 从 ${semantic} import ${name}，但契约 exports（${contractSource}）未声明该符号`,
        module: semantic,
        symbol: name,
        testFile: testRelPath,
        contractSource,
      };
    }
  }
  return null;
}

/** patch/mock 指向本切片模块未声明符号（T4 Run #38：patch main.SimBroker）→ test_write 硬阻断。 */
export function lintTestPatchTargetsAgainstModuleContract(params: {
  workspaceRoot: string;
  testRelPath: string;
  semantic: string;
  sliceArtifacts: DecisionArtifactsV1 | null | undefined;
  globalArtifacts: DecisionArtifactsV1 | null | undefined;
  sliceDecisionRecord?: string | null;
}): ModuleContractIssue | null {
  const { workspaceRoot, testRelPath, semantic, sliceArtifacts, globalArtifacts, sliceDecisionRecord } =
    params;
  const exports = resolveModuleExports(
    semantic,
    sliceArtifacts,
    globalArtifacts,
    sliceDecisionRecord,
  );
  if (!exports?.length) {
    return null;
  }
  const exportSet = new Set(exports);
  const abs = path.isAbsolute(testRelPath)
    ? testRelPath
    : path.join(workspaceRoot, testRelPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const content = fs.readFileSync(abs, 'utf8');
  const sliceEntry = sliceArtifacts?.modules?.find((m) => m.name === semantic);
  const contractSource =
    sliceEntry && (sliceEntry.exports?.length ?? 0) > 0 ? 'slice' : 'global';

  for (const m of content.matchAll(PATCH_TARGET_RE)) {
    const target = m[1]?.trim();
    if (!target?.includes('.')) {
      continue;
    }
    const modRoot = target.split('.')[0]!;
    if (modRoot !== semantic) {
      // 第二处 modRoot !== semantic：本函数只校验「patch 本切片自身模块的未声明符号」。
      // 跨切片 patch 目标交由 lintTestCrossModulePatchTargetsAgainstContracts 校验（按各模块契约），
      // 故此处 skip 而非 block——与 L101 import 侧的 order-aware 调和一致：跨模块引用不在此处拦，
      // 真实前序协作者允许、未声明符号由各自契约门拦。
      continue;
    }
    const symbol = target.split('.')[1]!;
    if (!symbol || exportSet.has(symbol)) {
      continue;
    }
    return {
      code: 'python-test-patch-undeclared-export',
      message: `module-contract：${testRelPath} patch ${target}，但契约 exports（${contractSource}）未声明 ${symbol}；应 patch 真实来源模块（如 broker.${symbol}）`,
      module: semantic,
      symbol,
      testFile: testRelPath,
      contractSource,
    };
  }
  return null;
}

/** patch 跨切片模块时，目标符号须在该模块契约 exports 中（T4 Run #41：patch indicators.compute_indicators）。 */
export function lintTestCrossModulePatchTargetsAgainstContracts(params: {
  workspaceRoot: string;
  testRelPath: string;
  instance: WorkflowInstance;
}): ModuleContractIssue | null {
  const { workspaceRoot, testRelPath, instance } = params;
  const abs = path.isAbsolute(testRelPath)
    ? testRelPath
    : path.join(workspaceRoot, testRelPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const content = fs.readFileSync(abs, 'utf8');

  for (const m of content.matchAll(PATCH_TARGET_RE)) {
    const target = m[1]?.trim();
    if (!target?.includes('.')) {
      continue;
    }
    const modRoot = target.split('.')[0]!;
    const symbol = target.split('.')[1]!;
    if (!PROJECT_SLICE_MODULE_NAMES.has(modRoot) || isExternalPythonModuleRoot(modRoot)) {
      continue;
    }
    const { sliceArtifacts, globalArtifacts, sliceDecisionRecord } = resolveSliceArtifacts(
      instance,
      modRoot,
    );
    const exports = resolveModuleExports(
      modRoot,
      sliceArtifacts,
      globalArtifacts,
      sliceDecisionRecord,
    );
    if (!exports?.length || exports.includes(symbol)) {
      continue;
    }
    return {
      code: 'python-test-patch-undeclared-export',
      message: `module-contract：${testRelPath} patch ${target}，但 ${modRoot} 契约 exports 未声明 ${symbol}（允许：${exports.join(', ')}）`,
      module: modRoot,
      symbol,
      testFile: testRelPath,
      contractSource: sliceArtifacts?.modules?.some((x) => x.name === modRoot && x.exports?.length)
        ? 'slice'
        : 'global',
    };
  }
  return null;
}

export function lintImplExportsAgainstModuleContract(params: {
  workspaceRoot: string;
  implRelPath: string;
  semantic: string;
  sliceArtifacts: DecisionArtifactsV1 | null | undefined;
  globalArtifacts: DecisionArtifactsV1 | null | undefined;
  sliceDecisionRecord?: string | null;
  /** 其它切片的导出符号；集成切片（main）契约误含下游函数时豁免 export-missing。 */
  crossSliceExports?: ReadonlySet<string>;
}): ModuleContractIssue | null {
  const { workspaceRoot, implRelPath, semantic, sliceArtifacts, globalArtifacts, sliceDecisionRecord, crossSliceExports } =
    params;
  const exports = resolveModuleExports(
    semantic,
    sliceArtifacts,
    globalArtifacts,
    sliceDecisionRecord,
  );
  if (!exports) {
    return null;
  }
  const abs = path.isAbsolute(implRelPath)
    ? implRelPath
    : path.join(workspaceRoot, implRelPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const content = fs.readFileSync(abs, 'utf8');
  const exported = extractExportedSymbols(content);
  // 可被 `from 本模块 import X` 导入的完整表面：顶层 def/class/__all__ + 顶层常量
  // （ALLOWED_TRANSITIONS）+ 顶层 from-import re-export（main `from pipeline import …` 后转出）。
  // 仅用于「缺失」判定；下方 export-extra 仍只看 def/class，内部常量/re-export 不误判多余。
  const importable = new Set([
    ...exported,
    ...extractModuleLevelConstants(content),
    ...extractImportedNames(content),
  ]);
  const contractSet = new Set(exports);
  const sliceEntry = sliceArtifacts?.modules?.find((m) => m.name === semantic);
  const contractSource =
    sliceEntry && (sliceEntry.exports?.length ?? 0) > 0 ? 'slice' : 'global';

  for (const sym of exports) {
    if (!importable.has(sym)) {
      // 集成切片 main 的契约常被 decide 误塞下游切片函数（main 只编排、不导出它们）。
      // 若该符号实为其它切片的导出且 main impl 未实现/转出，则豁免（非 main 的真实缺失）。
      if (semantic === 'main' && crossSliceExports?.has(sym)) {
        continue;
      }
      // main 入口同义词可互换：契约要 cli/run/main 任一，impl 实现了其中任一即视为满足
      // （三者是同一 CLI 入口的约定俗成别名，非「空心绿」——入口确实存在；T6 contract=cli / impl=run）。
      if (
        semantic === 'main' &&
        MAIN_ENTRY_CONVENTIONAL_EXPORTS.has(sym) &&
        [...MAIN_ENTRY_CONVENTIONAL_EXPORTS].some((alias) => importable.has(alias))
      ) {
        continue;
      }
      return {
        code: 'python-impl-export-missing',
        message: `module-contract：${implRelPath} 未导出契约符号 ${sym}（${contractSource}）`,
        module: semantic,
        symbol: sym,
        testFile: implRelPath,
        contractSource,
      };
    }
  }
  for (const sym of exported) {
    if (sym.startsWith('_') || contractSet.has(sym)) {
      continue;
    }
    if (semantic === 'main' && MAIN_ENTRY_CONVENTIONAL_EXPORTS.has(sym)) {
      continue;
    }
    return {
      code: 'python-impl-export-extra',
      message: `module-contract：${implRelPath} 导出未声明符号 ${sym}（契约 exports: ${exports.join(', ')}）`,
      module: semantic,
      symbol: sym,
      testFile: implRelPath,
      contractSource,
    };
  }
  return null;
}
