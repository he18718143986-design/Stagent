import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  findCanonicalKey,
  parseGlossary,
  serializeGlossary,
  upsertGlossaryTerm,
} from '../ProjectGlossaryStore';
import {
  adrFileName,
  formatAdrNumber,
  nextAdrNumber,
  renderAdrMarkdown,
  slugifyAdrTitle,
} from '../AdrStore';
import { lintCrossFileKeyContract } from '../CrossFileKeyContractLint';

const SAMPLE_CONTEXT = `# Project Context

Some intro.

## Glossary

- **sku** — 商品库存单元（canonical 键，禁止 tk_sku/skuId 漂移）
- **query_status** — 抓取结果状态枚举：success / not_found

## Other

- not a glossary entry
`;

test('parseGlossary 解析 Glossary 段', () => {
  const entries = parseGlossary(SAMPLE_CONTEXT);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].term, 'sku');
  assert.equal(entries[1].term, 'query_status');
  // 不越界吸入 Other 段
  assert.ok(!entries.some((e) => e.definition.includes('not a glossary')));
});

test('parseGlossary 无 Glossary 段返回空', () => {
  assert.deepEqual(parseGlossary('# nothing here'), []);
});

test('upsertGlossaryTerm 新增与更新（大小写不敏感）', () => {
  let entries = parseGlossary(SAMPLE_CONTEXT);
  entries = upsertGlossaryTerm(entries, 'asin', '亚马逊标准识别号');
  assert.equal(entries.length, 3);
  entries = upsertGlossaryTerm(entries, 'SKU', '更新后的定义');
  assert.equal(entries.length, 3);
  assert.equal(entries.find((e) => e.term.toLowerCase() === 'sku')?.definition, '更新后的定义');
});

test('serializeGlossary 稳定排序 + 可回环解析', () => {
  const entries = [
    { term: 'zeta', definition: 'z' },
    { term: 'alpha', definition: 'a' },
  ];
  const md = serializeGlossary(entries);
  assert.ok(md.indexOf('alpha') < md.indexOf('zeta'));
  const round = parseGlossary(md);
  assert.equal(round.length, 2);
});

test('findCanonicalKey：精确 / near-miss / 无关', () => {
  const entries = parseGlossary(SAMPLE_CONTEXT);
  assert.equal(findCanonicalKey(entries, 'sku'), 'sku');
  assert.equal(findCanonicalKey(entries, 'tk_sku'), 'sku'); // token 子集漂移
  assert.equal(findCanonicalKey(entries, 'completely_unrelated_field'), undefined);
});

test('lintCrossFileKeyContract：传入 canonical 字典 → 报 non-canonical-key', () => {
  const files = [
    { path: 'reader.py', content: "row = {'tk_sku': v, 'price': p}\nreturn row" },
    { path: 'writer.py', content: "out = {'tk_sku': x}\nprint(out)" },
  ];
  const res = lintCrossFileKeyContract(files, ['sku']);
  assert.ok(res.warnings.some((w) => w.startsWith('contract:non-canonical-key')));
});

test('lintCrossFileKeyContract：无 canonical 字典时不报 non-canonical（向后兼容）', () => {
  const files = [
    { path: 'reader.py', content: "row = {'tk_sku': v}\nreturn row" },
    { path: 'writer.py', content: "out = {'tk_sku': x}" },
  ];
  const res = lintCrossFileKeyContract(files);
  assert.ok(!res.warnings.some((w) => w.startsWith('contract:non-canonical-key')));
});

test('AdrStore：编号 / 文件名 / 渲染', () => {
  assert.equal(formatAdrNumber(7), '0007');
  assert.equal(slugifyAdrTitle('Use Redis for cache!'), 'use-redis-for-cache');
  assert.equal(nextAdrNumber(['0001-foo.md', '0003-bar.md']), 4);
  assert.equal(nextAdrNumber([]), 1);
  assert.equal(adrFileName({ number: 2, title: 'Adopt DAG scheduler' }), '0002-adopt-dag-scheduler.md');

  const md = renderAdrMarkdown({
    number: 2,
    title: 'Adopt DAG scheduler',
    status: 'accepted',
    date: '2026-05-30',
    context: 'linear executor 限制并行',
    decision: '引入 DAG 调度',
    consequences: '需新增 I-14/I-15 不变式',
  });
  assert.ok(md.includes('# 0002. Adopt DAG scheduler'));
  assert.ok(md.includes('## Decision'));
  assert.ok(md.includes('Status: accepted'));
});
