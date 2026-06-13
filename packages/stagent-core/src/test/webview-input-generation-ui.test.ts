import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildLlmWaitingDetail,
  formatStreamCharSuffix,
  stripStreamCharSuffix,
  INPUT_PAGE_BUSY_TITLES,
} from '../WebviewInputGenerationUi';

test('formatStreamCharSuffix omits zero or invalid counts', () => {
  assert.equal(formatStreamCharSuffix(0), '');
  assert.equal(formatStreamCharSuffix(-1), '');
  assert.equal(formatStreamCharSuffix(Number.NaN), '');
});

test('formatStreamCharSuffix shows approximate char count', () => {
  assert.equal(formatStreamCharSuffix(42), ' · 已接收约 42 字');
});

test('stripStreamCharSuffix removes all repeated stream suffixes', () => {
  const messy =
    '等待首 token… · 已接收约 2 字 · 已接收约 3 字 · 已接收约 1847 字';
  assert.equal(stripStreamCharSuffix(messy), '等待首 token…');
});

test('buildLlmWaitingDetail mentions auto taskType when enabled', () => {
  const auto = buildLlmWaitingDetail(true);
  assert.ok(auto.includes('taskType'));
  const manual = buildLlmWaitingDetail(false);
  assert.ok(!manual.includes('同时判断'));
  assert.ok(manual.includes('工作流 JSON'));
});

test('INPUT_PAGE_BUSY_TITLES covers workflow phases', () => {
  assert.ok(INPUT_PAGE_BUSY_TITLES.workflowPreparing.includes('上下文'));
  assert.ok(INPUT_PAGE_BUSY_TITLES.workflowLlm.includes('模型'));
  assert.ok(INPUT_PAGE_BUSY_TITLES.workflowValidating.includes('校验'));
});
