import * as crypto from 'crypto';
import { detectSdkFamilies } from '../SdkPathContractLint';
import type { Commitment, CommitmentKind } from './types';

const FILE_PATH_RE = /\b([A-Za-z0-9_./-]+\.(?:py|ts|tsx|js|jsx|json|toml|md))\b/g;
const API_SIG_RE = /\b([a-zA-Z_][\w]*)\s*\([^)]*\)/g;
function extractSectionBody(record: string, titleRegex: RegExp): string | null {
  const m = titleRegex.exec(record);
  if (!m) {
    return null;
  }
  const start = m.index + m[0].length;
  const rest = record.slice(start);
  const next = /\n###[\t ]/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function stableId(kind: CommitmentKind, subject: string, stageId: string): string {
  return crypto.createHash('sha256').update(`${stageId}:${kind}:${subject}`).digest('hex').slice(0, 16);
}

function pushUnique(
  out: Commitment[],
  seen: Set<string>,
  kind: CommitmentKind,
  subject: string,
  stageId: string,
  confidence: number,
): void {
  const id = stableId(kind, subject, stageId);
  if (seen.has(id)) {
    return;
  }
  seen.add(id);
  out.push({ id, kind, subject, source: 'parser', confidence, stageId });
}

export function hashDecisionRecord(record: string): string {
  return crypto.createHash('sha256').update(record.trim()).digest('hex').slice(0, 16);
}

export function parseCommitmentsFromDecisionRecord(
  record: string,
  stageId: string,
): { commitments: Commitment[]; warnings: string[] } {
  const commitments: Commitment[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const trimmed = record.trim();
  if (!trimmed) {
    return { commitments, warnings: ['empty decision record'] };
  }

  const boundary = extractSectionBody(trimmed, /^###[\t ]+职责边界[\t ]*$/m);
  if (boundary) {
    for (const line of boundary.split('\n').filter((l) => l.trim())) {
      pushUnique(commitments, seen, 'boundary', line.trim().slice(0, 200), stageId, 0.85);
    }
  } else {
    warnings.push('missing section: 职责边界');
  }

  const keyDecisions = extractSectionBody(trimmed, /^###[\t ]+关键设计决策[\t ]*$/m);
  if (keyDecisions) {
    let m: RegExpExecArray | null;
    FILE_PATH_RE.lastIndex = 0;
    while ((m = FILE_PATH_RE.exec(keyDecisions)) !== null) {
      pushUnique(commitments, seen, 'file_path', m[1]!, stageId, 0.8);
    }
    API_SIG_RE.lastIndex = 0;
    while ((m = API_SIG_RE.exec(keyDecisions)) !== null) {
      pushUnique(commitments, seen, 'api_signature', m[0]!, stageId, 0.75);
    }
  } else {
    warnings.push('missing section: 关键设计决策');
  }

  for (const family of detectSdkFamilies(trimmed)) {
    pushUnique(commitments, seen, 'sdk_family', family, stageId, 0.9);
  }

  const assumptions = extractSectionBody(trimmed, /^###[\t ]+AI[\t ]*无法验证的假设[\t ]*$/m);
  if (assumptions) {
    for (const line of assumptions.split('\n').filter((l) => /^\s*[-*]/.test(l))) {
      pushUnique(commitments, seen, 'assumption', line.replace(/^\s*[-*]\s*/, '').trim().slice(0, 200), stageId, 0.7);
    }
  }

  if (/tests\//i.test(trimmed) || /conftest/i.test(trimmed)) {
    pushUnique(commitments, seen, 'test_layout', 'flat+conftest', stageId, 0.65);
  }

  return { commitments, warnings };
}

// fix typo in pushUnique call - I used `out:` instead of commitments