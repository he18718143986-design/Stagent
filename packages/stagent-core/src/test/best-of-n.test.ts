import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  selectBestCandidate,
  summarizeCandidates,
} from '../best-of-n/selectBestCandidate';
import { compareCandidates } from '../best-of-n/candidateRank';
import type { CandidateOutcome } from '../best-of-n/BestOfNTypes';

test('selectBestCandidate: single passing candidate is selected', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: false },
    { id: 'attempt-2', passed: true },
    { id: 'attempt-3', passed: false },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'attempt-2');
  assert.equal(result.ranked[0].id, 'attempt-2');
  assert.equal(result.ranked.length, 3);
});

test('selectBestCandidate: smokePassed breaks tie between passing candidates', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: true, smokePassed: false },
    { id: 'attempt-2', passed: true, smokePassed: true },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'attempt-2');
  assert.equal(result.ranked[0].id, 'attempt-2');
  assert.equal(result.ranked[1].id, 'attempt-1');
});

test('selectBestCandidate: qualityScore breaks tie when smoke equal', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: true, smokePassed: true, qualityScore: 0.4 },
    { id: 'attempt-2', passed: true, smokePassed: true, qualityScore: 0.9 },
    { id: 'attempt-3', passed: true, smokePassed: true, qualityScore: 0.7 },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'attempt-2');
  assert.deepEqual(
    result.ranked.map((c) => c.id),
    ['attempt-2', 'attempt-3', 'attempt-1'],
  );
});

test('selectBestCandidate: testsFailed breaks tie when smoke+quality equal', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: true, smokePassed: true, qualityScore: 0.5, testsFailed: 3 },
    { id: 'attempt-2', passed: true, smokePassed: true, qualityScore: 0.5, testsFailed: 0 },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'attempt-2');
});

test('selectBestCandidate: gateViolations and testsPassed are lower-priority tiebreakers', () => {
  const base = { passed: true, smokePassed: true, qualityScore: 0.5, testsFailed: 0 };
  const gateTie: CandidateOutcome[] = [
    { id: 'a', ...base, gateViolations: 2, testsPassed: 10 },
    { id: 'b', ...base, gateViolations: 0, testsPassed: 1 },
  ];
  assert.equal(selectBestCandidate(gateTie).selectedId, 'b');

  const testsTie: CandidateOutcome[] = [
    { id: 'a', ...base, gateViolations: 0, testsPassed: 5 },
    { id: 'b', ...base, gateViolations: 0, testsPassed: 12 },
  ];
  assert.equal(selectBestCandidate(testsTie).selectedId, 'b');
});

test('selectBestCandidate: full tie preserves original order (stable)', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: true, smokePassed: true, qualityScore: 0.5, testsFailed: 0, gateViolations: 0, testsPassed: 4 },
    { id: 'attempt-2', passed: true, smokePassed: true, qualityScore: 0.5, testsFailed: 0, gateViolations: 0, testsPassed: 4 },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'attempt-1');
  assert.deepEqual(
    result.ranked.map((c) => c.id),
    ['attempt-1', 'attempt-2'],
  );
});

test('selectBestCandidate: all-fail returns null and a reason', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'attempt-1', passed: false, testsFailed: 2 },
    { id: 'attempt-2', passed: false, testsFailed: 1 },
    { id: 'attempt-3', passed: false, testsFailed: 5 },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, null);
  assert.ok(result.reason.includes('3'));
  assert.ok(result.reason.includes('Strict QA'));
  // Best-ranked failing candidate (fewest testsFailed) sorts first.
  assert.equal(result.ranked[0].id, 'attempt-2');
});

test('selectBestCandidate: empty array returns no-candidate fallback', () => {
  const result = selectBestCandidate([]);
  assert.deepEqual(result, { selectedId: null, reason: '无候选', ranked: [] });
});

test('selectBestCandidate: non-array input does not throw', () => {
  // @ts-expect-error intentionally passing malformed input
  const result = selectBestCandidate(null);
  assert.deepEqual(result, { selectedId: null, reason: '无候选', ranked: [] });
  // @ts-expect-error intentionally passing malformed input
  const result2 = selectBestCandidate(undefined);
  assert.equal(result2.selectedId, null);
});

test('selectBestCandidate: malformed candidates (missing fields) fall back defensively', () => {
  const candidates = [
    { id: 'a' }, // missing passed -> treated as false
    { id: 'b', passed: true }, // missing everything else
    { id: 'c', passed: 'yes' }, // wrong type -> treated as false
  ] as unknown as CandidateOutcome[];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'b');
  assert.equal(result.ranked[0].id, 'b');
});

test('selectBestCandidate: missing qualityScore sorts after present one', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'a', passed: true, smokePassed: true },
    { id: 'b', passed: true, smokePassed: true, qualityScore: 0.1 },
  ];
  const result = selectBestCandidate(candidates);
  assert.equal(result.selectedId, 'b');
});

test('summarizeCandidates: counts pass/fail correctly', () => {
  const candidates: CandidateOutcome[] = [
    { id: 'a', passed: true },
    { id: 'b', passed: false },
    { id: 'c', passed: true },
  ];
  assert.deepEqual(summarizeCandidates(candidates), { total: 3, passed: 2, failed: 1 });
});

test('summarizeCandidates: non-array input returns all zero', () => {
  // @ts-expect-error intentionally passing malformed input
  assert.deepEqual(summarizeCandidates(null), { total: 0, passed: 0, failed: 0 });
  // @ts-expect-error intentionally passing malformed input
  assert.deepEqual(summarizeCandidates('nope'), { total: 0, passed: 0, failed: 0 });
  assert.deepEqual(summarizeCandidates([]), { total: 0, passed: 0, failed: 0 });
});

test('compareCandidates: passing candidate sorts before failing', () => {
  const pass: CandidateOutcome = { id: 'p', passed: true };
  const fail: CandidateOutcome = { id: 'f', passed: false };
  assert.ok(compareCandidates(pass, fail) < 0);
  assert.ok(compareCandidates(fail, pass) > 0);
  assert.equal(compareCandidates(pass, pass), 0);
});
