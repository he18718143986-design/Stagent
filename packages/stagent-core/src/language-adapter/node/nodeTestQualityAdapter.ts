/**
 * Node/TS 测试质量 detector（对标 `python/pythonTestQualityAdapter.ts`，见 ADR-0005）。
 *
 * 仅负责「如何在 TS/JS（vitest/jest）测试里识别坏味」并给出 JS 术语的 detail；
 * 坏味的 type/hard 分级由 core `TestQualityLint` 的 policy 决定（PR-2 接入生效路径）。
 *
 * 与 python adapter 不同：生产模块名**参数化**（`createNodeTestQualityAdapter(productionModules)`），
 * 避免把 Python 默认模块表硬塞进 Node 任务（ADR-0005 决策 3）。
 */
import type {
  LanguageTestQualityAdapter,
  TestQualityFinding,
} from '../LanguageTestQualityAdapter';

/** Node 缺省生产模块名（调用方未注入切片语义时回退）。 */
export const DEFAULT_NODE_PRODUCTION_MODULES: readonly string[] = ['src', 'app', 'lib', 'main'];

const NODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

const ASSERT_LINE = /\bexpect\s*\(|\bassert\s*\(|\bassert\.\w+\s*\(/;

// 恒真：expect(true).toBe(true) / expect(1).toBe(1) / expect('x').toBe('x') /
// expect(true).toBeTruthy() / assert(true) / assert.ok(true)
const TAUTOLOGY =
  /expect\(\s*(true|false)\s*\)\s*\.toBe\(\s*\1\s*\)|expect\(\s*(\d+)\s*\)\s*\.toBe\(\s*\2\s*\)|expect\(\s*(['"][^'"]*['"])\s*\)\s*\.toBe\(\s*\3\s*\)|expect\(\s*true\s*\)\s*\.toBeTruthy\(\)|assert(?:\.ok)?\(\s*true\s*\)/;

// 「存在性」断言：toBeDefined / not.toBeUndefined / not.toBeNull / toBeTruthy
const EXISTENCE_MATCHER = /\.toBeDefined\(\)|\.not\.toBeUndefined\(\)|\.not\.toBeNull\(\)|\.toBeTruthy\(\)/;
// 「实质值」断言：验证真实输出/行为（出现任一即非 existence-only，不依赖分行）
const SUBSTANTIVE_MATCHER =
  /\.toBe\(|\.toEqual\(|\.toStrictEqual\(|\.toThrow\(|\.toContain\(|\.toMatch\(|\.toHaveLength\(|\.toHaveBeenCalled|\.toBeGreaterThan|\.toBeLessThan|\.toBeCloseTo|\bassert\.(?:equal|deepEqual|deepStrictEqual|strictEqual|match|throws)\b/;

// 断言私有实现细节：expect(obj._private) / expect(obj['_x']) / expect(obj.#priv)
const IMPLEMENTATION_DETAIL =
  /expect\([^)]*\._[A-Za-z]|expect\([^)]*\[\s*['"]_|expect\([^)]*\.#[A-Za-z]/;

// 测试内联定义被测实现类（排除以 Test/Mock/Fake/Stub 开头的测试替身）。
const INLINE_CLASS_RE = /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z][A-Za-z0-9_]*)/gm;

// import x from 'p' / import 'p' / require('p')
const IMPORT_RE =
  /\bimport\b[^\n]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

// vi.mock('p') / jest.mock('p')
const MODULE_MOCK_RE = /\b(?:vi|jest)\.mock\(\s*['"]([^'"]+)['"]/g;
// vi.doMock('p', …) / jest.doMock('p', …) —— 带工厂的整体替身
const DOMOCK_RE = /\b(?:vi|jest)\.doMock\(\s*['"]([^'"]+)['"]\s*,/g;
// require.cache[…] = …（模块系统劫持）
const REQUIRE_CACHE_WRITE_RE = /require\.cache\s*\[[^\]]*\]\s*=/;
const REQUIRE_RESOLVE_IN_CACHE_RE =
  /require\.cache\s*\[\s*require\.resolve\(\s*['"]([^'"]+)['"]\s*\)\s*\]\s*=/g;

// 协作者 mock 假绿（ADR-0008 决策2）：vi.fn()/jest.fn() 协作者 + 仅断言调用形状
const MOCK_CREATE_RE = /\b(?:vi|jest)\.fn\s*\(|\b(?:vi|jest)\.spyOn\s*\(/;
const CALL_SHAPE_ASSERT_RE =
  /\.toHaveBeenCalled(?:Times|With)?\b|\.toHaveBeenLastCalledWith\b|\.toHaveBeenNthCalledWith\b|\.toBeCalled(?:Times|With)?\b/;

// 脆弱断言：=== NaN（恒 false，应 Number.isNaN）；toThrow 内置运行时错误消息原文
const NAN_COMPARE_RE = /[!=]==?\s*NaN\b|\bNaN\s*[!=]==?/;
const TOTHROW_BUILTIN_RE =
  /\.toThrow\(\s*['"][^'"]*(?:Cannot read|Cannot set propert|is not a function|is not defined|undefined is not|null is not)[^'"]*['"]\s*\)/i;

function hasAnyAssertion(code: string): boolean {
  return code.split(/\r?\n/).some((l) => ASSERT_LINE.test(l));
}

function looksLikeTest(code: string): boolean {
  return /\b(?:describe|it|test)\s*\(|\bexpect\s*\(|\bfrom\s+['"](?:vitest|@jest\/globals)['"]|\brequire\(\s*['"](?:vitest|@jest)/.test(
    code,
  );
}

/** import/require 源路径拆出的「段」集合（去扩展名、小写；忽略 . 与 ..）。 */
function importedPathSegments(code: string): Set<string> {
  const segs = new Set<string>();
  for (const m of code.matchAll(IMPORT_RE)) {
    const src = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!src) {
      continue;
    }
    for (const raw of src.split('/')) {
      const s = raw.replace(NODE_EXT_RE, '').trim().toLowerCase();
      if (s && s !== '.' && s !== '..') {
        segs.add(s);
      }
    }
  }
  return segs;
}

function normalizeModules(productionModules: readonly string[]): string[] {
  const list = (productionModules.length > 0 ? productionModules : DEFAULT_NODE_PRODUCTION_MODULES)
    .map((m) => m.trim().replace(NODE_EXT_RE, '').toLowerCase())
    .filter(Boolean);
  return [...new Set(list)];
}

/** 路径任一段命中生产模块名。 */
function pathHitsProduction(p: string, prod: readonly string[]): boolean {
  const set = new Set(
    p
      .split('/')
      .map((s) => s.replace(NODE_EXT_RE, '').trim().toLowerCase())
      .filter((s) => s && s !== '.' && s !== '..'),
  );
  return prod.some((m) => set.has(m));
}

function extractInlineImplClasses(code: string): string[] {
  const names: string[] = [];
  for (const m of code.matchAll(INLINE_CLASS_RE)) {
    const name = m[1];
    if (name && !/^(?:Test|Mock|Fake|Stub)/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

function detectProductionBinding(code: string, prod: string[]): TestQualityFinding[] {
  if (!code.trim() || !looksLikeTest(code)) {
    return [];
  }
  const segs = importedPathSegments(code);
  const hasProductionImport = prod.some((m) => segs.has(m));
  const inlineClasses = extractInlineImplClasses(code);
  if (inlineClasses.length > 0 && !hasProductionImport) {
    return [
      {
        kind: 'missing-production-import',
        detail: `测试未 import 生产模块（${prod.join(', ')}）；可能为内联 Test Double 假绿`,
      },
      {
        kind: 'inline-impl-double',
        detail: `测试内联定义 impl 类（${inlineClasses.slice(0, 4).join(', ')}），未绑定真实模块`,
      },
    ];
  }
  return [];
}

function detectInternalModuleMocks(code: string, prod: string[]): TestQualityFinding[] {
  if (!code.trim() || !looksLikeTest(code)) {
    return [];
  }
  const targets = new Set<string>();
  for (const m of code.matchAll(MODULE_MOCK_RE)) {
    const p = m[1]?.trim();
    if (p && pathHitsProduction(p, prod)) {
      targets.add(p);
    }
  }
  if (targets.size > 0) {
    return [
      {
        kind: 'internal-module-mock',
        detail: `vi.mock/jest.mock 指向项目内模块（${[...targets].slice(0, 3).join(', ')}），可能绕过真实集成`,
      },
    ];
  }
  return [];
}

function detectModuleSystemHijack(code: string, prod: string[]): TestQualityFinding[] {
  if (!code.trim() || !looksLikeTest(code)) {
    return [];
  }
  const targets = new Set<string>();
  // require.cache 写入（劫持模块系统）。能解析出生产模块路径则记之，否则记 require.cache。
  if (REQUIRE_CACHE_WRITE_RE.test(code)) {
    let matchedResolve = false;
    for (const m of code.matchAll(REQUIRE_RESOLVE_IN_CACHE_RE)) {
      const p = m[1]?.trim();
      if (p && pathHitsProduction(p, prod)) {
        targets.add(p);
        matchedResolve = true;
      }
    }
    if (!matchedResolve) {
      targets.add('require.cache');
    }
  }
  // doMock 整体替身覆盖被测模块本体。
  for (const m of code.matchAll(DOMOCK_RE)) {
    const p = m[1]?.trim();
    if (p && pathHitsProduction(p, prod)) {
      targets.add(p);
    }
  }
  if (targets.size > 0) {
    return [
      {
        kind: 'module-system-hijack',
        detail: `劫持模块系统（${[...targets].slice(0, 3).join(', ')}），impl 再正确也测不到真实代码`,
      },
    ];
  }
  return [];
}

function detectCollaboratorMockOnly(code: string): TestQualityFinding[] {
  if (!code.trim() || !looksLikeTest(code)) {
    return [];
  }
  if (MOCK_CREATE_RE.test(code) && CALL_SHAPE_ASSERT_RE.test(code)) {
    return [
      {
        kind: 'collaborator-mock-only',
        detail:
          '把协作者替换为 vi.fn()/spyOn 且仅断言调用形状（toHaveBeenCalled*），未验证真实行为；建议补真实集成测试',
      },
    ];
  }
  return [];
}

function detectBrittleAssertions(code: string): TestQualityFinding[] {
  if (!code.trim() || !looksLikeTest(code)) {
    return [];
  }
  const findings: TestQualityFinding[] = [];
  if (NAN_COMPARE_RE.test(code)) {
    findings.push({
      kind: 'brittle-assertion',
      detail: '与 NaN 直接比较（=== NaN）恒为 false：应使用 Number.isNaN()',
    });
  }
  if (TOTHROW_BUILTIN_RE.test(code)) {
    findings.push({
      kind: 'brittle-assertion',
      detail: 'toThrow 匹配内置运行时错误消息原文，随 Node/库版本变化；应断言自定义错误类型或去掉消息匹配',
    });
  }
  return findings;
}

function detectFindings(code: string, prod: string[]): TestQualityFinding[] {
  const src = code ?? '';
  if (!src.trim()) {
    return [];
  }
  const findings: TestQualityFinding[] = [];

  if (looksLikeTest(src) && !hasAnyAssertion(src)) {
    findings.push({
      kind: 'no-assertion',
      detail: '测试缺少任何断言（expect/assert），无法验证行为',
    });
  }

  if (TAUTOLOGY.test(src)) {
    findings.push({
      kind: 'tautological-assertion',
      detail: '存在恒真断言（如 expect(true).toBe(true)），等于没测',
    });
  }

  const existenceOnly =
    hasAnyAssertion(src) && EXISTENCE_MATCHER.test(src) && !SUBSTANTIVE_MATCHER.test(src);
  if (existenceOnly) {
    findings.push({
      kind: 'existence-only',
      detail: '仅断言对象/模块存在（toBeDefined / not.toBeNull），未验证真实行为或输出',
    });
  } else if (IMPLEMENTATION_DETAIL.test(src)) {
    findings.push({
      kind: 'implementation-detail',
      detail: '断言指向私有实现细节（._private / #priv），耦合实现而非行为',
    });
  }

  findings.push(...detectProductionBinding(src, prod));
  findings.push(...detectInternalModuleMocks(src, prod));
  findings.push(...detectModuleSystemHijack(src, prod));
  findings.push(...detectCollaboratorMockOnly(src));
  findings.push(...detectBrittleAssertions(src));

  return findings;
}

/**
 * 构造 Node 测试质量 adapter；`productionModules` 为当前任务切片语义的模块名（参数化）。
 */
export function createNodeTestQualityAdapter(
  productionModules: readonly string[] = DEFAULT_NODE_PRODUCTION_MODULES,
): LanguageTestQualityAdapter {
  const prod = normalizeModules(productionModules);
  return {
    id: 'node',
    looksLikeTest,
    detectFindings: (code: string) => detectFindings(code, prod),
  };
}

/** 默认实例（与 `pythonTestQualityAdapter` 导出形状对齐；使用缺省生产模块表）。 */
export const nodeTestQualityAdapter: LanguageTestQualityAdapter = createNodeTestQualityAdapter();
