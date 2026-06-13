import * as path from 'node:path';
import { detectAdrCriteria } from '../ADRCriteriaDetector';
import type { CharterDocument } from '../CharterTypes';
import {
  isAdrLabelByFeatures,
  loadAdrCalibrationQuestions,
  type AdrCalibrationQuestion,
} from './loadCalibrationQuestions';

export interface AdrDetectorMetrics {
  total: number;
  adrTotal: number;
  nonAdrTotal: number;
  adrRecall: number;
  nonAdrFalsePositiveRate: number;
  featureAgreementRate: number;
  failures: Array<{ id: string; label: string; expected: boolean; got: boolean; features: AdrCalibrationQuestion['features'] }>;
}

export function evaluateAdrDetectorMetrics(
  questions: AdrCalibrationQuestion[],
  charter?: CharterDocument | null,
): AdrDetectorMetrics {
  const failures: AdrDetectorMetrics['failures'] = [];
  let adrHit = 0;
  let adrTotal = 0;
  let nonAdrFalse = 0;
  let nonAdrTotal = 0;
  let featureAgree = 0;

  for (const row of questions) {
    const result = detectAdrCriteria(row.text, charter);
    const expectedEscalate = row.label === 'adr';
    if (expectedEscalate) {
      adrTotal += 1;
      if (result.mustEscalate) {
        adrHit += 1;
      } else {
        failures.push({
          id: row.id,
          label: row.label,
          expected: true,
          got: false,
          features: row.features,
        });
      }
    } else {
      nonAdrTotal += 1;
      if (result.mustEscalate) {
        nonAdrFalse += 1;
        failures.push({
          id: row.id,
          label: row.label,
          expected: false,
          got: true,
          features: row.features,
        });
      }
    }
    const expectedFeatures = isAdrLabelByFeatures(row.features);
    const gotFeatures = result.mustEscalate;
    if (expectedFeatures === gotFeatures) {
      featureAgree += 1;
    }
  }

  return {
    total: questions.length,
    adrTotal,
    nonAdrTotal,
    adrRecall: adrTotal === 0 ? 1 : adrHit / adrTotal,
    nonAdrFalsePositiveRate: nonAdrTotal === 0 ? 0 : nonAdrFalse / nonAdrTotal,
    featureAgreementRate: questions.length === 0 ? 1 : featureAgree / questions.length,
    failures,
  };
}

/** 默认 repo 相对路径：`.stagent/charter/calibration/questions.jsonl`。 */
export function defaultCalibrationQuestionsPath(repoRoot: string): string {
  return path.join(repoRoot, '.stagent/charter/calibration/questions.jsonl');
}

export function evaluateAdrDetectorFromFile(
  filePath: string,
  charter?: CharterDocument | null,
): AdrDetectorMetrics {
  return evaluateAdrDetectorMetrics(loadAdrCalibrationQuestions(filePath), charter);
}
