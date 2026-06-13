import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isNearMissKeyPair,
  levenshtein,
  lintCrossFileKeyContract,
} from '../CrossFileKeyContractLint';

test('levenshtein basic distances', () => {
  assert.equal(levenshtein('stock', 'stock'), 0);
  assert.equal(levenshtein('sku', 'tk_sku'), 3);
  assert.equal(levenshtein('delivary', 'delivery'), 1);
});

test('isNearMissKeyPair: edit-distance ≤2 and token-subset drift', () => {
  assert.equal(isNearMissKeyPair('delivary_date', 'delivery_date').near, true); // 1 edit
  assert.equal(isNearMissKeyPair('sku', 'tk_sku').near, true); // sku ⊂ {tk,sku}
  assert.equal(isNearMissKeyPair('expected_stock', 'stock').near, true); // stock ⊂ {expected,stock}
  assert.equal(isNearMissKeyPair('asin', 'price').near, false);
  assert.equal(isNearMissKeyPair('stock', 'stock').near, false); // equal → not a mismatch
});

test('detects reader(tk_sku/stock) vs analyzer(sku/expected_stock) drift', () => {
  const reader = {
    path: 'reader.py',
    content: `
def read_excel(p):
    records = []
    records.append({'asin': asin, 'tk_sku': sku, 'target_price': tp, 'stock': st})
    return records
`,
  };
  const analyzer = {
    path: 'analyzer.py',
    content: `
def analyze(rows):
    for row in rows:
        a = row['asin']
        sku = row.get('sku')
        es = row.get('expected_stock')
`,
  };
  const { mismatches, warnings } = lintCrossFileKeyContract([reader, analyzer]);
  const consumed = mismatches.map((m) => m.consumedKey).sort();
  assert.deepEqual(consumed, ['expected_stock', 'sku']);
  assert.ok(mismatches.some((m) => m.consumedKey === 'sku' && m.nearestProducedKey === 'tk_sku'));
  assert.ok(mismatches.some((m) => m.consumedKey === 'expected_stock' && m.nearestProducedKey === 'stock'));
  assert.ok(warnings.every((w) => w.startsWith('contract:cross-file-key-mismatch:')));
});

test('exact-match keys across files produce no mismatch', () => {
  const producer = {
    path: 'fetcher.py',
    content: `return [{'asin': a, 'price': p, 'stock_status': s}]`,
  };
  const consumer = {
    path: 'analyzer.py',
    content: `
x = item.get('asin')
y = item.get('price')
z = item.get('stock_status')
`,
  };
  assert.deepEqual(lintCrossFileKeyContract([producer, consumer]).mismatches, []);
});

test('single file or empty input → no mismatches', () => {
  assert.deepEqual(lintCrossFileKeyContract([]).mismatches, []);
  assert.deepEqual(
    lintCrossFileKeyContract([{ path: 'a.py', content: "{'asin': 1}; row.get('sku')" }]).mismatches,
    [],
  );
});
