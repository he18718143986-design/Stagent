import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildMainEntryRunnablePreventionSuffix,
  buildNoPlaceholderExportPreventionSuffix,
  buildRealCollaboratorTestPreventionSuffix,
} from '../commitment/deliverablePreventionSuffixes';

test('main-entry prevention: 仅 main 切片注入，含 __main__ 守卫要求', () => {
  const suffix = buildMainEntryRunnablePreventionSuffix('main');
  assert.ok(suffix);
  assert.match(suffix!, /__main__/);
  assert.match(suffix!, /真正可运行|产出非平凡/);
});

test('main-entry prevention: 非 main 切片返回 null（无噪声）', () => {
  assert.equal(buildMainEntryRunnablePreventionSuffix('store'), null);
  assert.equal(buildMainEntryRunnablePreventionSuffix(undefined), null);
});

test('no-placeholder prevention: 列出自赋值与无意义常量反例', () => {
  const suffix = buildNoPlaceholderExportPreventionSuffix();
  assert.match(suffix, /PermissionError = PermissionError/);
  assert.match(suffix, /null = None/);
  assert.match(suffix, /禁止占位导出/);
});

test('real-collaborator prevention: 禁止整体 mock 内部协作者只断言 call shape', () => {
  const suffix = buildRealCollaboratorTestPreventionSuffix('pipeline');
  assert.match(suffix, /collaborator-mock-only/);
  assert.match(suffix, /真实协作者/);
  assert.match(suffix, /`pipeline`/);
});

test('real-collaborator prevention: semantic 缺省时仍可生成（用「本」兜底）', () => {
  const suffix = buildRealCollaboratorTestPreventionSuffix(undefined);
  assert.match(suffix, /本 切片|本切片|本 /);
});
