import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildPrDescription } from '../pr-output/buildPrDescription';
import {
  buildReviewSummary,
  summarizeFindingCounts,
} from '../pr-output/buildReviewSummary';
import type {
  PrDescriptionInput,
  ReviewFinding,
  ReviewSummaryInput,
} from '../pr-output/PrOutputTypes';

// ---------- buildPrDescription ----------

test('buildPrDescription: full input renders goal/acceptance/deliverables/verification sections', () => {
  const input: PrDescriptionInput = {
    title: 'Add summary export',
    taskGoal: 'Generate summary.json from input data',
    acceptance: ['summary.json is non-trivial', 'CLI exits 0'],
    deliverables: ['main.py', 'summary.json'],
    changedFiles: ['main.py', 'README.md'],
    quality: { testsPassed: 12, testsFailed: 0, smokePassed: true, notes: ['vitest green'] },
    verificationEvidence: ['.venv/bin/python main.py → summary.json: {...} 非平凡'],
  };
  const md = buildPrDescription(input);

  assert.ok(md.includes('# Add summary export'));
  assert.ok(md.includes('## 目标'));
  assert.ok(md.includes('Generate summary.json from input data'));
  assert.ok(md.includes('## 完成标准'));
  assert.ok(md.includes('- summary.json is non-trivial'));
  assert.ok(md.includes('## 交付物'));
  assert.ok(md.includes('- main.py'));
  assert.ok(md.includes('## 变更文件'));
  assert.ok(md.includes('- README.md'));
  assert.ok(md.includes('## 验证'));
  assert.ok(md.includes('通过 12 / 失败 0'));
  assert.ok(md.includes('Smoke：通过'));
  assert.ok(md.includes('备注：vitest green'));
  assert.ok(md.includes('.venv/bin/python main.py'));
  // all-green: no warning line
  assert.ok(!md.includes('⚠️ 验证未全绿'));
});

test('buildPrDescription: testsFailed>0 adds the not-green warning', () => {
  const md = buildPrDescription({
    title: 'WIP',
    quality: { testsPassed: 3, testsFailed: 2 },
  });
  assert.ok(md.includes('⚠️ 验证未全绿'));
});

test('buildPrDescription: smokePassed===false adds the not-green warning', () => {
  const md = buildPrDescription({ quality: { smokePassed: false } });
  assert.ok(md.includes('⚠️ 验证未全绿'));
});

test('buildPrDescription: empty input {} returns string, does not throw, omits undefined sections', () => {
  let md = '';
  assert.doesNotThrow(() => {
    md = buildPrDescription({});
  });
  assert.equal(typeof md, 'string');
  assert.ok(md.length > 0);
  assert.ok(md.includes('#')); // placeholder title heading
  assert.ok(!md.includes('## 目标'));
  assert.ok(!md.includes('## 完成标准'));
  assert.ok(!md.includes('## 交付物'));
  assert.ok(!md.includes('## 变更文件'));
  assert.ok(!md.includes('## 验证'));
  assert.ok(!md.includes('undefined'));
});

test('buildPrDescription: non-object input does not throw', () => {
  assert.doesNotThrow(() => {
    // @ts-expect-error testing runtime safety with bad input
    buildPrDescription(undefined);
    // @ts-expect-error testing runtime safety with bad input
    buildPrDescription(null);
  });
});

// ---------- buildReviewSummary ----------

test('buildReviewSummary: error+warn+info grouped with error first', () => {
  const input: ReviewSummaryInput = {
    findings: [
      { severity: 'info', message: 'style nit', location: 'a.ts:1' },
      { severity: 'error', message: 'null deref', location: 'b.ts:42' },
      { severity: 'warn', message: 'unused var' },
    ],
  };
  const md = buildReviewSummary(input);

  assert.ok(md.includes('## Error'));
  assert.ok(md.includes('## Warn'));
  assert.ok(md.includes('## Info'));
  assert.ok(md.includes('null deref (b.ts:42)'));
  assert.ok(md.includes('unused var'));

  const errorIdx = md.indexOf('## Error');
  const warnIdx = md.indexOf('## Warn');
  const infoIdx = md.indexOf('## Info');
  assert.ok(errorIdx < warnIdx, 'error before warn');
  assert.ok(warnIdx < infoIdx, 'warn before info');
});

test('buildReviewSummary: empty findings outputs no-findings line', () => {
  const md = buildReviewSummary({ findings: [] });
  assert.ok(md.includes('无评审发现'));
  const md2 = buildReviewSummary({});
  assert.ok(md2.includes('无评审发现'));
});

test('buildReviewSummary: renders quality and verification', () => {
  const md = buildReviewSummary({
    findings: [{ severity: 'warn', message: 'check me' }],
    quality: { testsPassed: 5, testsFailed: 1, smokePassed: false },
    verificationEvidence: ['main.py → summary.json non-trivial'],
  });
  assert.ok(md.includes('## 验证'));
  assert.ok(md.includes('通过 5 / 失败 1'));
  assert.ok(md.includes('Smoke：未通过'));
  assert.ok(md.includes('证据：main.py → summary.json non-trivial'));
});

test('buildReviewSummary: never throws on bad input', () => {
  assert.doesNotThrow(() => {
    // @ts-expect-error testing runtime safety with bad input
    buildReviewSummary(undefined);
    // @ts-expect-error testing runtime safety with bad input
    buildReviewSummary({ findings: 'not-an-array' });
  });
});

// ---------- summarizeFindingCounts ----------

test('summarizeFindingCounts: counts correctly', () => {
  const findings: ReviewFinding[] = [
    { severity: 'error', message: 'e1' },
    { severity: 'error', message: 'e2' },
    { severity: 'warn', message: 'w1' },
    { severity: 'info', message: 'i1' },
    { severity: 'info', message: 'i2' },
    { severity: 'info', message: 'i3' },
  ];
  assert.deepEqual(summarizeFindingCounts(findings), { error: 2, warn: 1, info: 3 });
});

test('summarizeFindingCounts: non-array returns all zero and does not throw', () => {
  // @ts-expect-error testing runtime safety with bad input
  assert.deepEqual(summarizeFindingCounts(undefined), { error: 0, warn: 0, info: 0 });
  // @ts-expect-error testing runtime safety with bad input
  assert.deepEqual(summarizeFindingCounts(null), { error: 0, warn: 0, info: 0 });
  // @ts-expect-error testing runtime safety with bad input
  assert.deepEqual(summarizeFindingCounts('nope'), { error: 0, warn: 0, info: 0 });
});

test('summarizeFindingCounts: ignores malformed entries', () => {
  const findings = [
    { severity: 'error', message: 'ok' },
    { severity: 'bogus', message: 'x' },
    { severity: 'warn' },
    null,
  ] as unknown as ReviewFinding[];
  assert.deepEqual(summarizeFindingCounts(findings), { error: 1, warn: 0, info: 0 });
});
