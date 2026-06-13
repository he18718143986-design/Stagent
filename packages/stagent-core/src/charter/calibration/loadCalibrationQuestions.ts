import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AdrCalibrationFeatures {
  irreversible: boolean;
  surprising: boolean;
  tradeoff: boolean;
}

export type AdrCalibrationLabel = 'adr' | 'non-adr';

export interface AdrCalibrationQuestion {
  id: string;
  text: string;
  label: AdrCalibrationLabel;
  rationale: string;
  features: AdrCalibrationFeatures;
}

/** Gate 1 ground truth：三条 features 全 true 才为 ADR 级（与 ADR-0003 一致）。 */
export function isAdrLabelByFeatures(features: AdrCalibrationFeatures): boolean {
  return features.irreversible && features.surprising && features.tradeoff;
}

function parseJsonlLine(line: string, lineNo: number): AdrCalibrationQuestion | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  let row: AdrCalibrationQuestion;
  try {
    row = JSON.parse(trimmed) as AdrCalibrationQuestion;
  } catch (e) {
    throw new Error(`calibration jsonl line ${lineNo}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!row.id?.trim() || !row.text?.trim() || !row.label) {
    throw new Error(`calibration jsonl line ${lineNo}: missing id/text/label`);
  }
  if (row.label !== 'adr' && row.label !== 'non-adr') {
    throw new Error(`calibration jsonl line ${lineNo}: label must be adr|non-adr`);
  }
  if (!row.features || typeof row.features !== 'object') {
    throw new Error(`calibration jsonl line ${lineNo}: missing features`);
  }
  const expectedAdr = isAdrLabelByFeatures(row.features);
  const labeledAdr = row.label === 'adr';
  if (expectedAdr !== labeledAdr) {
    throw new Error(
      `calibration jsonl line ${lineNo} (${row.id}): label/features mismatch — AND(features)=${expectedAdr} but label=${row.label}`,
    );
  }
  return row;
}

/** 加载 `.stagent/charter/calibration/questions.jsonl`（PR-2 Gate 1 验收 ground truth）。 */
export function loadAdrCalibrationQuestions(filePath: string): AdrCalibrationQuestion[] {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const out: AdrCalibrationQuestion[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const row = parseJsonlLine(lines[i]!, i + 1);
    if (row) {
      out.push(row);
    }
  }
  return out;
}
