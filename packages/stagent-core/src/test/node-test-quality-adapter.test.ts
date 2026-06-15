import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  createNodeTestQualityAdapter,
  nodeTestQualityAdapter,
} from '../language-adapter/node/nodeTestQualityAdapter';
import type { TestQualityFindingKind } from '../language-adapter/LanguageTestQualityAdapter';

const adapter = createNodeTestQualityAdapter(['store', 'models']);

function kinds(code: string): TestQualityFindingKind[] {
  return adapter.detectFindings(code).map((f) => f.kind);
}

// A0 looksLikeTest
test('A0 looksLikeTest: describe/it/expect/import vitest → true', () => {
  assert.equal(adapter.looksLikeTest("describe('x', () => { it('y', () => {}) })"), true);
  assert.equal(adapter.looksLikeTest("test('y', () => { expect(1).toBe(1) })"), true);
  assert.equal(
    adapter.looksLikeTest("import { expect } from 'vitest'\nexpect(a).toEqual(b)"),
    true,
  );
});

test('A0 looksLikeTest: plain impl / comments → false', () => {
  assert.equal(adapter.looksLikeTest('export function add(a, b) { return a + b }'), false);
  assert.equal(adapter.looksLikeTest('// just a comment\ntype X = number'), false);
});

// A1 no-assertion
test('A1 no-assertion: positive / negative / guard', () => {
  assert.ok(kinds("it('does x', () => { const r = add(1,2) })").includes('no-assertion'));
  assert.ok(!kinds("it('does x', () => { expect(add(1,2)).toBe(3) })").includes('no-assertion'));
  assert.ok(!kinds('const r = add(1,2)').includes('no-assertion')); // not a test → guard
});

// A2 tautological
test('A2 tautological: positives / negatives', () => {
  assert.ok(kinds("it('t', () => { expect(true).toBe(true) })").includes('tautological-assertion'));
  assert.ok(kinds("it('t', () => { expect(1).toBe(1) })").includes('tautological-assertion'));
  assert.ok(kinds("it('t', () => { assert.ok(true) })").includes('tautological-assertion'));
  assert.ok(
    !kinds("it('t', () => { expect(result).toBe(true) })").includes('tautological-assertion'),
  );
  assert.ok(!kinds("it('t', () => { expect(sum).toBe(3) })").includes('tautological-assertion'));
});

// A3 existence-only
test('A3 existence-only: positives / negatives', () => {
  assert.ok(
    kinds("it('t', () => { expect(mod).toBeDefined() })").includes('existence-only'),
  );
  assert.ok(
    kinds("it('t', () => { expect(x).not.toBeNull(); expect(y).toBeTruthy() })").includes(
      'existence-only',
    ),
  );
  // 混有实质断言 → 不报 existence-only
  assert.ok(
    !kinds("it('t', () => { expect(mod).toBeDefined(); expect(mod.run()).toBe(42) })").includes(
      'existence-only',
    ),
  );
  // 无断言 → 归 A1 而非 A3
  assert.ok(!kinds("it('t', () => { const r = run() })").includes('existence-only'));
});

// A4 implementation-detail
test('A4 implementation-detail: positives / negatives', () => {
  assert.ok(
    kinds("it('t', () => { expect(obj._private).toBe(1) })").includes('implementation-detail'),
  );
  assert.ok(
    kinds("it('t', () => { expect(obj['_internal']).toBe(2) })").includes('implementation-detail'),
  );
  assert.ok(
    !kinds("it('t', () => { expect(obj.publicValue).toBe(1) })").includes('implementation-detail'),
  );
  // existence-only 命中时不再报 implementation-detail（互斥，对齐 python）
  assert.ok(
    !kinds("it('t', () => { expect(obj._x).toBeDefined() })").includes('implementation-detail'),
  );
});

// A5/A6 missing-production-import + inline-impl-double
test('A5/A6 inline impl class without production import → both findings', () => {
  const code = [
    "import { describe, it, expect } from 'vitest'",
    "describe('store', () => {",
    '  class TaskStore { add() { return 1 } }',
    "  it('adds', () => { expect(new TaskStore().add()).toBe(1) })",
    '})',
  ].join('\n');
  const k = kinds(code);
  assert.ok(k.includes('missing-production-import'));
  assert.ok(k.includes('inline-impl-double'));
});

test('A5/A6 negatives: real import / Test-prefixed helper', () => {
  const withImport = [
    "import { TaskStore } from '../store'",
    "import { it, expect } from 'vitest'",
    "it('adds', () => { expect(new TaskStore().add()).toBe(1) })",
  ].join('\n');
  assert.ok(!kinds(withImport).includes('inline-impl-double'));

  const testHelper = [
    "import { it, expect } from 'vitest'",
    'class TestHelper { build() { return 1 } }',
    "it('adds', () => { expect(new TestHelper().build()).toBe(1) })",
  ].join('\n');
  assert.ok(!kinds(testHelper).includes('inline-impl-double'));
});

// A7 internal-module-mock
test('A7 internal-module-mock: project mock vs third-party', () => {
  assert.ok(
    kinds("import { vi } from 'vitest'\nvi.mock('../store')\nit('t',()=>{expect(1).toBe(2)})").includes(
      'internal-module-mock',
    ),
  );
  assert.ok(
    !kinds("import { vi } from 'vitest'\nvi.mock('axios')\nit('t',()=>{expect(1).toBe(2)})").includes(
      'internal-module-mock',
    ),
  );
});

// A8 module-system-hijack
test('A8 module-system-hijack: require.cache / doMock prod vs third-party', () => {
  const cacheHijack =
    "import { it, expect } from 'vitest'\nrequire.cache[require.resolve('../store')] = { exports: {} }\nit('t',()=>{expect(1).toBe(2)})";
  assert.ok(kinds(cacheHijack).includes('module-system-hijack'));

  const doMockProd =
    "import { vi } from 'vitest'\nvi.doMock('../store', () => ({ TaskStore: class {} }))\nit('t',()=>{expect(1).toBe(2)})";
  assert.ok(kinds(doMockProd).includes('module-system-hijack'));

  const doMockThird =
    "import { vi } from 'vitest'\nvi.doMock('axios', () => ({}))\nit('t',()=>{expect(1).toBe(2)})";
  assert.ok(!kinds(doMockThird).includes('module-system-hijack'));
});

// A9 brittle-assertion
test('A9 brittle-assertion: NaN compare / builtin message vs custom', () => {
  assert.ok(
    kinds("it('t', () => { expect(x === NaN).toBe(false) })").includes('brittle-assertion'),
  );
  assert.ok(
    kinds(
      "it('t', () => { expect(() => f()).toThrow('Cannot read properties of undefined') })",
    ).includes('brittle-assertion'),
  );
  assert.ok(
    !kinds("it('t', () => { expect(() => f()).toThrow(MyCustomError) })").includes(
      'brittle-assertion',
    ),
  );
  assert.ok(
    !kinds("it('t', () => { expect(Number.isNaN(x)).toBe(true) })").includes('brittle-assertion'),
  );
});

// collaborator-mock-only (ADR-0008 决策2)
test('collaborator-mock-only: vi.fn collaborator + toHaveBeenCalled → flagged', () => {
  const code = [
    "import { it, expect, vi } from 'vitest'",
    "it('imports', () => {",
    '  const store = { add: vi.fn() }',
    "  importTasks('x.csv', store)",
    '  expect(store.add).toHaveBeenCalledWith({ title: \'a\' })',
    '})',
  ].join('\n');
  assert.ok(kinds(code).includes('collaborator-mock-only'));
});

test('collaborator-mock-only: real assertion (no call-shape-only) → not flagged', () => {
  assert.ok(
    !kinds("it('t', () => { expect(add(1,2)).toBe(3) })").includes('collaborator-mock-only'),
  );
});

// A10 ordering & aggregation / empty / default instance
test('A10 empty input → []', () => {
  assert.deepEqual(adapter.detectFindings(''), []);
  assert.deepEqual(adapter.detectFindings('   \n  '), []);
});

test('A10 default instance (nodeTestQualityAdapter) id=node, looksLikeTest works', () => {
  assert.equal(nodeTestQualityAdapter.id, 'node');
  assert.equal(nodeTestQualityAdapter.looksLikeTest("it('y', () => { expect(1).toBe(1) })"), true);
});
