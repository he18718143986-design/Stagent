import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { checkConstraintBoundary } from '../charter/ConstraintBoundaryChecker';
import { matchCharterToDecision } from '../charter/CharterAnswerRouter';
import {
  isAdrLabelByFeatures,
  loadAdrCalibrationQuestions,
} from '../charter/calibration/loadCalibrationQuestions';
import { parseCharterMarkdown } from '../charter/CharterParser';

const T4_CHARTER = parseCharterMarkdown(
  'charter.md',
  `## 约束（Constraints）
- Python 3.10+；部署形态为无 Web 界面的单进程服务
- 接口：send_order(req) -> OrderResult；公共接口用返回值表达错误，不抛异常`,
);

test('checkConstraintBoundary: escalates web UI proposal against no-web constraint', () => {
  const r = checkConstraintBoundary(
    T4_CHARTER,
    '建议增加 Flask Web 管理界面，方便运维查看持仓',
  );
  assert.equal(r.mustEscalate, true);
  assert.ok(r.ruleRefs.length > 0);
  assert.ok(r.messages.some((m) => m.includes('单进程') || m.includes('Web')));
});

test('checkConstraintBoundary: passes pytest layout question', () => {
  const r = checkConstraintBoundary(T4_CHARTER, '测试目录用 tests/ 还是 src/tests/？');
  assert.equal(r.mustEscalate, false);
});

test('checkConstraintBoundary: question alone can trigger contradiction hints', () => {
  const r = checkConstraintBoundary(T4_CHARTER, '是否改为多进程微服务部署并加 Web 控制台？');
  assert.equal(r.mustEscalate, true);
});

test('matchCharterToDecision: Gate 2 escalates before charter_direct when proposal violates', () => {
  const doc = parseCharterMarkdown(
    'c.md',
    `## 优先（Prefer）
- 优先 headless 可测
## 约束（Constraints）
- 必须支持 node 18 运行时`,
  );
  const m = matchCharterToDecision('是否放弃 node 18 改为 node 16 运行时？', doc, 0.95);
  assert.equal(m.provenance, 'escalated');
  assert.equal(m.kind, 'conflict');
  assert.ok(m.reasoning?.includes('Gate 2'));
});

test('isAdrLabelByFeatures: AND logic for adr label', () => {
  assert.equal(
    isAdrLabelByFeatures({ irreversible: true, surprising: true, tradeoff: true }),
    true,
  );
  assert.equal(
    isAdrLabelByFeatures({ irreversible: true, surprising: false, tradeoff: true }),
    false,
  );
});

test('loadAdrCalibrationQuestions: seed jsonl validates label/features consistency', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  const file = path.join(repoRoot, '.stagent/charter/calibration/questions.jsonl');
  const rows = loadAdrCalibrationQuestions(file);
  assert.ok(rows.length >= 7);
  assert.ok(rows.some((r) => r.id === 't4-01' && r.label === 'adr'));
  assert.ok(rows.some((r) => r.id === 't4-02' && r.label === 'non-adr'));
});
