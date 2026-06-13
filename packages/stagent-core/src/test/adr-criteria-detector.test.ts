import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { detectAdrCriteria } from '../charter/ADRCriteriaDetector';
import {
  defaultCalibrationQuestionsPath,
  evaluateAdrDetectorFromFile,
} from '../charter/calibration/evaluateAdrDetector';
import { loadAdrCalibrationQuestions } from '../charter/calibration/loadCalibrationQuestions';
import { matchCharterToDecision } from '../charter/CharterAnswerRouter';
import { parseCharterMarkdown } from '../charter/CharterParser';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CALIBRATION_FILE = defaultCalibrationQuestionsPath(REPO_ROOT);

test('detectAdrCriteria: calibration rows match label', () => {
  const rows = loadAdrCalibrationQuestions(CALIBRATION_FILE);
  for (const row of rows) {
    const r = detectAdrCriteria(row.text, null);
    const expectEscalate = row.label === 'adr';
    assert.equal(
      r.mustEscalate,
      expectEscalate,
      `${row.id}: expected mustEscalate=${expectEscalate}, got ${r.mustEscalate} features=${JSON.stringify(r.features)}`,
    );
  }
});

test('evaluateAdrDetector: adr recall >= 95% and non-adr FP <= 5%', () => {
  const metrics = evaluateAdrDetectorFromFile(CALIBRATION_FILE, null);
  assert.ok(metrics.adrRecall >= 0.95, `adrRecall=${metrics.adrRecall} failures=${JSON.stringify(metrics.failures)}`);
  assert.ok(
    metrics.nonAdrFalsePositiveRate <= 0.05,
    `nonAdrFalsePositiveRate=${metrics.nonAdrFalsePositiveRate}`,
  );
});

test('matchCharterToDecision: Gate 1 escalates ADR question before auto answer', () => {
  const doc = parseCharterMarkdown(
    'c.md',
    `## 避免（Avoid）
- 避免为减文件数而合并 unrelated seam`,
  );
  const m = matchCharterToDecision(
    'MarketGateway 是否应该设计为 abstract base class 还是 Protocol？',
    doc,
    0.95,
  );
  assert.equal(m.provenance, 'escalated');
  assert.ok(m.reasoning?.includes('Gate 1'));
});
