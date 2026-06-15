import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { checkWritePathAllowed } from '../capability/writeScope';
import { classifyCommandRisk } from '../capability/commandRisk';
import {
  evaluateCommandCapability,
  evaluateWriteCapability,
} from '../capability/evaluateCapability';
import type { StageCapabilities } from '../capability/StageCapabilityTypes';

// ---------- writeScope ----------

test('writeScope: allowedWritePaths glob ** allows in-scope, denies out-of-scope', () => {
  const caps: StageCapabilities = { allowedWritePaths: ['src/store/**'] };

  const inScope = checkWritePathAllowed(caps, 'src/store/a.ts');
  assert.equal(inScope.allowed, true);
  assert.equal(inScope.violation, undefined);

  const outScope = checkWritePathAllowed(caps, 'src/models/a.ts');
  assert.equal(outScope.allowed, false);
  assert.equal(outScope.violation?.kind, 'write-out-of-scope');
});

test('writeScope: deniedWritePaths takes priority and yields write-denied', () => {
  const caps: StageCapabilities = {
    allowedWritePaths: ['**'],
    deniedWritePaths: ['.env'],
  };
  const r = checkWritePathAllowed(caps, '.env');
  assert.equal(r.allowed, false);
  assert.equal(r.violation?.kind, 'write-denied');
});

test('writeScope: path escaping with .. is write-out-of-scope', () => {
  const caps: StageCapabilities = { allowedWritePaths: ['src/store/**'] };
  const r = checkWritePathAllowed(caps, '../escape');
  assert.equal(r.allowed, false);
  assert.equal(r.violation?.kind, 'write-out-of-scope');

  // backslash form normalizes the same way
  const r2 = checkWritePathAllowed(caps, '..\\escape');
  assert.equal(r2.allowed, false);
  assert.equal(r2.violation?.kind, 'write-out-of-scope');
});

test('writeScope: no caps or no allowedWritePaths -> allowed (backward compatible)', () => {
  assert.equal(checkWritePathAllowed(undefined, 'anything/here.ts').allowed, true);
  assert.equal(checkWritePathAllowed({}, 'anything/here.ts').allowed, true);
  assert.equal(
    checkWritePathAllowed({ deniedWritePaths: ['.env'] }, 'src/anything.ts').allowed,
    true,
  );
});

test('writeScope: exact and prefix patterns match', () => {
  assert.equal(checkWritePathAllowed({ allowedWritePaths: ['config.json'] }, 'config.json').allowed, true);
  assert.equal(checkWritePathAllowed({ allowedWritePaths: ['config.json'] }, 'other.json').allowed, false);
  assert.equal(checkWritePathAllowed({ allowedWritePaths: ['src/store/'] }, 'src/store/x/y.ts').allowed, true);
  // normalizes ./ prefix
  assert.equal(checkWritePathAllowed({ allowedWritePaths: ['src/store/**'] }, './src/store/a.ts').allowed, true);
});

// ---------- commandRisk ----------

test('commandRisk: high-risk commands are flagged', () => {
  for (const cmd of ['git push --force origin main', 'rm -rf build', 'sudo rm /tmp/x', 'DROP TABLE users']) {
    const r = classifyCommandRisk(cmd);
    assert.equal(r.highRisk, true, `expected high risk for: ${cmd}`);
    assert.ok(r.reasons.length > 0, `expected reasons for: ${cmd}`);
  }
  assert.ok(classifyCommandRisk('git push --force origin main').reasons.includes('git-push-force'));
  assert.ok(classifyCommandRisk('rm -rf build').reasons.includes('rm-rf'));
  assert.ok(classifyCommandRisk('sudo rm /tmp/x').reasons.includes('sudo'));
  assert.ok(classifyCommandRisk('DROP TABLE users').reasons.includes('sql-drop-table'));
});

test('commandRisk: benign commands are not flagged', () => {
  for (const cmd of ['npm test', 'vitest run', 'python main.py']) {
    const r = classifyCommandRisk(cmd);
    assert.equal(r.highRisk, false, `expected low risk for: ${cmd}`);
    assert.equal(r.reasons.length, 0);
  }
});

test('commandRisk: empty / non-string is safe', () => {
  assert.deepEqual(classifyCommandRisk(''), { highRisk: false, reasons: [] });
  // @ts-expect-error testing non-string runtime safety
  assert.deepEqual(classifyCommandRisk(undefined), { highRisk: false, reasons: [] });
  // @ts-expect-error testing non-string runtime safety
  assert.deepEqual(classifyCommandRisk(123), { highRisk: false, reasons: [] });
});

// ---------- evaluateCommandCapability ----------

test('evaluateCommandCapability: allowedCommands miss -> command-not-allowed (allowed=false)', () => {
  const caps: StageCapabilities = { allowedCommands: ['npm', 'vitest'] };
  const d = evaluateCommandCapability(caps, 'git push');
  assert.equal(d.allowed, false);
  assert.ok(d.violations.some((v) => v.kind === 'command-not-allowed'));
});

test('evaluateCommandCapability: no allowedCommands + high risk -> allowed but requiresApproval', () => {
  const caps: StageCapabilities = {};
  const d = evaluateCommandCapability(caps, 'git push --force');
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, true);
  assert.ok(d.violations.some((v) => v.kind === 'high-risk-command'));
});

test('evaluateCommandCapability: highRiskNeedsApproval=false -> requiresApproval=false', () => {
  const caps: StageCapabilities = { highRiskNeedsApproval: false };
  const d = evaluateCommandCapability(caps, 'git push --force');
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
  assert.ok(d.violations.some((v) => v.kind === 'high-risk-command'));
});

test('evaluateCommandCapability: no caps -> allowed, no approval, no violations', () => {
  const d = evaluateCommandCapability(undefined, 'git push --force');
  assert.deepEqual(d, { allowed: true, requiresApproval: false, violations: [] });
});

// ---------- evaluateWriteCapability ----------

test('evaluateWriteCapability: out-of-scope write -> allowed=false with violation', () => {
  const caps: StageCapabilities = { allowedWritePaths: ['src/store/**'] };
  const d = evaluateWriteCapability(caps, '../escape');
  assert.equal(d.allowed, false);
  assert.equal(d.requiresApproval, false);
  assert.equal(d.violations[0]?.kind, 'write-out-of-scope');
});

test('evaluateWriteCapability: no caps -> allowed', () => {
  const d = evaluateWriteCapability(undefined, 'src/models/a.ts');
  assert.equal(d.allowed, true);
  assert.equal(d.violations.length, 0);
});
