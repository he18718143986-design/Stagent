import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { analyzeFailurePatterns } from '../FailurePatternAnalyzer';
import { WorkflowExperienceStore } from '../WorkflowExperienceStore';
import { CandidateRuleStore } from '../rule-distillation/CandidateRuleStore';
import {
  formatCandidateRuleDistillationSummary,
  OFFLINE_NO_AUTO_PROMOTE_THRESHOLDS,
  runRuleDistillation,
} from '../rule-distillation/runRuleDistillation';
import { candidateRuleId } from '../rule-distillation/distillCandidateRules';

const CORE_ROOT = path.resolve(__dirname, '../..');
const SAMPLE_EXPERIENCES = path.join(
  CORE_ROOT,
  'scripts/fixtures/experiences/sample-experiences.jsonl',
);

const FIXED_NOW = () => '2026-06-16T12:00:00.000Z';

function fixtureWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-rd-wire-'));
  fs.mkdirSync(path.join(tmp, '.stagent'), { recursive: true });
  fs.copyFileSync(SAMPLE_EXPERIENCES, path.join(tmp, '.stagent', 'experiences.jsonl'));
  return tmp;
}

test('runRuleDistillation: fixture experiences → needs_review candidates on disk', () => {
  const workspace = fixtureWorkspace();
  const experiencePath = path.join(workspace, '.stagent', 'experiences.jsonl');
  const candidatePath = path.join(workspace, '.stagent', 'candidate-rules.jsonl');

  const result = runRuleDistillation({
    experienceStorePath: experiencePath,
    candidateStorePath: candidatePath,
    now: FIXED_NOW,
  });

  assert.ok(result.summary.total >= 1);
  assert.ok(result.summary.newIds.length >= 1);
  assert.ok(fs.existsSync(candidatePath));

  const onDisk = new CandidateRuleStore(candidatePath).readAll();
  assert.equal(onDisk.length, result.distilled.length);
  for (const rule of onDisk) {
    assert.equal(rule.status, 'needs_review');
    assert.equal(rule.serves, 0);
    assert.equal(rule.acceptanceRate, 0);
  }

  const report = analyzeFailurePatterns(new WorkflowExperienceStore(experiencePath).readAll());
  const expectedId = candidateRuleId('tool-execution-failed::stage_impl_auth');
  assert.ok(
    onDisk.some((r) => r.id === expectedId),
    `expected rule for impl_auth cluster, got ${onDisk.map((r) => r.id).join(', ')}`,
  );
  assert.equal(report.patterns.find((p) => p.patternId.includes('stage_impl_auth'))?.frequency, 2);
});

test('runRuleDistillation: no rule becomes active (serves=0 + unreachable thresholds)', () => {
  const workspace = fixtureWorkspace();
  const result = runRuleDistillation({
    experienceStorePath: path.join(workspace, '.stagent', 'experiences.jsonl'),
    candidateStorePath: path.join(workspace, '.stagent', 'candidate-rules.jsonl'),
    thresholds: OFFLINE_NO_AUTO_PROMOTE_THRESHOLDS,
    now: FIXED_NOW,
  });

  assert.equal(result.summary.byStatus.active ?? 0, 0);
  assert.ok(result.distilled.every((r) => r.status === 'needs_review'));
});

test('runRuleDistillation: idempotent — same input no duplicate ids, updatedAt refreshes', () => {
  const workspace = fixtureWorkspace();
  const experiencePath = path.join(workspace, '.stagent', 'experiences.jsonl');
  const candidatePath = path.join(workspace, '.stagent', 'candidate-rules.jsonl');

  const first = runRuleDistillation({
    experienceStorePath: experiencePath,
    candidateStorePath: candidatePath,
    now: FIXED_NOW,
  });
  const countAfterFirst = new CandidateRuleStore(candidatePath).readAll().length;
  const firstUpdatedAt = first.distilled[0]?.updatedAt;

  const LATER = () => '2026-06-16T13:00:00.000Z';
  const second = runRuleDistillation({
    experienceStorePath: experiencePath,
    candidateStorePath: candidatePath,
    now: LATER,
  });
  const onDisk = new CandidateRuleStore(candidatePath).readAll();

  assert.equal(onDisk.length, countAfterFirst);
  assert.equal(second.summary.newIds.length, 0);
  assert.ok(firstUpdatedAt);
  assert.equal(onDisk[0]?.updatedAt, '2026-06-16T13:00:00.000Z');
  assert.equal(onDisk[0]?.createdAt, first.distilled[0]?.createdAt);
});

test('analyze-experiences CLI --distill creates candidate-rules.jsonl and prints summary', () => {
  const tmp = fixtureWorkspace();
  const candidatePath = path.join(tmp, '.stagent', 'candidate-rules.jsonl');
  const out = execSync(
    `npx ts-node scripts/analyze-experiences.ts --workspace "${tmp}" --distill --candidate-store "${candidatePath}"`,
    { encoding: 'utf-8', cwd: CORE_ROOT },
  );

  assert.ok(out.includes('Actionable pattern kinds'));
  assert.ok(out.includes('## Candidate rules (distillation)'));
  assert.ok(out.includes('needs_review'));
  assert.ok(fs.existsSync(candidatePath));
  assert.ok(new CandidateRuleStore(candidatePath).readAll().length >= 1);
});

test('formatCandidateRuleDistillationSummary lists needs_review id/kind/message', () => {
  const rules = [
    {
      id: 'cr_x',
      kind: 'stage-impl-failure',
      patternId: 'p',
      message: 'check impl',
      sourcePatternIds: ['p'],
      serves: 0,
      hits: 2,
      acceptanceRate: 0,
      status: 'needs_review' as const,
      createdAt: 't',
      updatedAt: 't',
    },
  ];
  const text = formatCandidateRuleDistillationSummary(rules, {
    total: 1,
    byStatus: { needs_review: 1 },
    newIds: ['cr_x'],
  });
  assert.ok(text.includes('cr_x'));
  assert.ok(text.includes('stage-impl-failure'));
  assert.ok(text.includes('check impl'));
});
