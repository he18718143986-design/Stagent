import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  routeScenario,
  SKILL_GRILL_ME,
  SKILL_GRILL_WITH_DOCS,
  SKILL_PROTOTYPE,
  SKILL_TDD,
  SKILL_TO_ISSUES,
  SKILL_TO_PRD,
  SKILL_ZOOM_OUT,
  SKILL_DIAGNOSE,
  SKILL_IMPROVE_ARCH,
  SKILL_SETUP,
  type RepoSnapshot,
} from '../ScenarioRouter';

const brown: RepoSnapshot = { isGreenfield: false };
const green: RepoSnapshot = { isGreenfield: true };

test('debug → debug 模板（triage → diagnose → tdd）', () => {
  const r = routeScenario({ taskType: 'debug', repo: brown });
  assert.equal(r.template, 'debug');
  assert.ok(r.skillSequence.includes(SKILL_DIAGNOSE));
  assert.ok(r.skillSequence.includes(SKILL_TDD));
});

test('refactor / improve-architecture → arch_review', () => {
  for (const t of ['refactor', 'improve-architecture']) {
    const r = routeScenario({ taskType: t, repo: brown });
    assert.equal(r.template, 'arch_review');
    assert.deepEqual(r.skillSequence, [SKILL_IMPROVE_ARCH]);
  }
});

test('绿场 + 多切片 → greenfield_full（含 setup + grill-with-docs + prd + issues + tdd）', () => {
  const r = routeScenario({ taskType: 'software', estimatedScope: 'multi_slice', repo: green });
  assert.equal(r.template, 'greenfield_full');
  assert.deepEqual(r.skillSequence, [
    SKILL_SETUP,
    SKILL_GRILL_WITH_DOCS,
    SKILL_TO_PRD,
    SKILL_TO_ISSUES,
    SKILL_TDD,
  ]);
});

test('非绿场 + 单切片 + 不动陌生模块 → express（grill-me → tdd）', () => {
  const r = routeScenario({ taskType: 'software', estimatedScope: 'single_slice', repo: brown });
  assert.equal(r.template, 'express');
  assert.deepEqual(r.skillSequence, [SKILL_GRILL_ME, SKILL_TDD]);
});

test('非绿场 + 动陌生模块 → brownfield_full 且含 zoom-out 门禁', () => {
  const r = routeScenario({
    taskType: 'software',
    estimatedScope: 'single_slice',
    repo: { isGreenfield: false, touchesUnknownModule: true },
  });
  assert.equal(r.template, 'brownfield_full');
  assert.ok(r.skillSequence.includes(SKILL_ZOOM_OUT));
  assert.ok(r.skillSequence.includes(SKILL_GRILL_WITH_DOCS));
});

test('非绿场 + 范围不确定 → brownfield_full（保守，无 zoom-out）', () => {
  const r = routeScenario({ taskType: 'software', estimatedScope: 'unknown', repo: brown });
  assert.equal(r.template, 'brownfield_full');
  assert.equal(r.skillSequence.includes(SKILL_ZOOM_OUT), false);
});

test('prototype taskType → 在主序列插入 prototype skill', () => {
  const g = routeScenario({ taskType: 'prototype', estimatedScope: 'multi_slice', repo: green });
  assert.ok(g.skillSequence.includes(SKILL_PROTOTYPE));
  const e = routeScenario({ taskType: 'prototype', estimatedScope: 'single_slice', repo: brown });
  assert.ok(e.skillSequence.includes(SKILL_PROTOTYPE));
});

test('每条路由都带可读 reason', () => {
  const r = routeScenario({ taskType: 'software', repo: brown });
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
});
