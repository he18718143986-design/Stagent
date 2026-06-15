import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DEFAULT_TASK_BRIEF_RELATIVE_PATH,
  parseTaskBrief,
  readTaskBriefFromWorkspace,
} from '../task-brief/parseTaskBrief';
import { validateTaskBrief } from '../task-brief/validateTaskBrief';
import { checkScopeCreep } from '../task-brief/taskBriefScopeCheck';
import { formatTaskBriefMarkdown } from '../task-brief/formatTaskBrief';
import type { TaskBrief } from '../task-brief/TaskBriefTypes';

test('parseTaskBrief: full object → TaskBrief', () => {
  const brief = parseTaskBrief({
    goal: 'build feature',
    nonGoals: ['no payments', '  '],
    boundaries: ['typescript only'],
    acceptance: ['tests pass'],
  });
  assert.deepEqual(brief, {
    goal: 'build feature',
    nonGoals: ['no payments'],
    boundaries: ['typescript only'],
    acceptance: ['tests pass'],
  });
});

test('parseTaskBrief: missing goal → null', () => {
  assert.equal(parseTaskBrief({ nonGoals: ['x'] }), null);
});

test('parseTaskBrief: blank goal → null', () => {
  assert.equal(parseTaskBrief({ goal: '   ' }), null);
});

test('parseTaskBrief: string nonGoals → single-element array', () => {
  const brief = parseTaskBrief({ goal: 'g', nonGoals: 'x' });
  assert.deepEqual(brief?.nonGoals, ['x']);
});

test('parseTaskBrief: blank items dropped', () => {
  const brief = parseTaskBrief({
    goal: 'g',
    boundaries: ['  ', 'keep', ''],
    acceptance: ['  done  '],
  });
  assert.deepEqual(brief?.boundaries, ['keep']);
  assert.deepEqual(brief?.acceptance, ['done']);
});

test('parseTaskBrief: defaults to empty arrays', () => {
  const brief = parseTaskBrief({ goal: 'g' });
  assert.deepEqual(brief, { goal: 'g', nonGoals: [], boundaries: [], acceptance: [] });
});

test('parseTaskBrief: non-object → null', () => {
  assert.equal(parseTaskBrief('nope'), null);
  assert.equal(parseTaskBrief(42), null);
  assert.equal(parseTaskBrief(null), null);
  assert.equal(parseTaskBrief(['a']), null);
});

test('readTaskBriefFromWorkspace: round-trips written file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-brief-'));
  const abs = path.join(dir, DEFAULT_TASK_BRIEF_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const brief: TaskBrief = {
    goal: 'g',
    nonGoals: ['n'],
    boundaries: ['b'],
    acceptance: ['a'],
  };
  fs.writeFileSync(abs, JSON.stringify(brief), 'utf8');
  assert.deepEqual(readTaskBriefFromWorkspace(dir), brief);
});

test('readTaskBriefFromWorkspace: missing file → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-brief-'));
  assert.equal(readTaskBriefFromWorkspace(dir), null);
});

test('readTaskBriefFromWorkspace: bad JSON → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-brief-'));
  const abs = path.join(dir, DEFAULT_TASK_BRIEF_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '{ not json', 'utf8');
  assert.equal(readTaskBriefFromWorkspace(dir), null);
});

test('validateTaskBrief: non-empty goal → ok', () => {
  const result = validateTaskBrief({
    goal: 'g',
    nonGoals: ['n'],
    boundaries: ['b'],
    acceptance: ['a'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('validateTaskBrief: empty goal → not ok + issue', () => {
  const result = validateTaskBrief({
    goal: '   ',
    nonGoals: ['n'],
    boundaries: ['b'],
    acceptance: ['a'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes('goal')));
});

test('validateTaskBrief: empty acceptance → ok but soft issue', () => {
  const result = validateTaskBrief({
    goal: 'g',
    nonGoals: ['n'],
    boundaries: ['b'],
    acceptance: [],
  });
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((i) => i.includes('acceptance')));
});

test('checkScopeCreep: non-goal touched', () => {
  const brief: TaskBrief = {
    goal: 'g',
    nonGoals: ['支付集成'],
    boundaries: [],
    acceptance: [],
  };
  const findings = checkScopeCreep(brief, '本次计划加入支付集成功能');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'non-goal-touched');
  assert.equal(findings[0].term, '支付集成');
});

test('checkScopeCreep: boundary violated', () => {
  const brief: TaskBrief = {
    goal: 'g',
    nonGoals: [],
    boundaries: ['第三方库'],
    acceptance: [],
  };
  const findings = checkScopeCreep(brief, '引入 axios 第三方库');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'boundary-violated');
  assert.equal(findings[0].term, '第三方库');
});

test('checkScopeCreep: no match → []', () => {
  const brief: TaskBrief = {
    goal: 'g',
    nonGoals: ['支付集成'],
    boundaries: ['第三方库'],
    acceptance: [],
  };
  assert.deepEqual(checkScopeCreep(brief, '完全无关的文本'), []);
});

test('checkScopeCreep: non-string candidate → [] (no throw)', () => {
  const brief: TaskBrief = {
    goal: 'g',
    nonGoals: ['支付集成'],
    boundaries: [],
    acceptance: [],
  };
  assert.deepEqual(checkScopeCreep(brief, undefined as unknown as string), []);
  assert.deepEqual(checkScopeCreep(brief, 123 as unknown as string), []);
  assert.deepEqual(checkScopeCreep(brief, ''), []);
});

test('formatTaskBriefMarkdown: renders all sections', () => {
  const md = formatTaskBriefMarkdown({
    goal: 'g',
    nonGoals: ['n'],
    boundaries: ['b'],
    acceptance: ['a'],
  });
  assert.ok(md.includes('## 目标'));
  assert.ok(md.includes('## 非目标'));
  assert.ok(md.includes('## 边界'));
  assert.ok(md.includes('## 完成标准'));
  assert.ok(md.includes('- n'));
});
