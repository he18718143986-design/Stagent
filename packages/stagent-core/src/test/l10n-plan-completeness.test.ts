import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { planCompletenessMsg } from '../l10n/lintMsg';

function withWarnCapture(fn: () => void): string[] {
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return warnings;
}

test('planCompletenessMsg resolves catalog keys (no missing-key warning, placeholders filled)', () => {
  const cases: Array<[string, Array<string | number>]> = [
    ['missing-python-venv-chain', ['venv-chain']],
    ['missing-python-test-layout', ['conftest.py']],
    ['missing-python-verify-imports', ['t_write.py', 't_run']],
    ['missing-verification-stage', []],
    ['missing-main-assembly', []],
    ['missing-test-infrastructure', []],
    ['slice-decide-missing-decision-artifacts', ['stage_decide_x']],
    ['global-decide-missing-decision-artifacts', ['stage_decide_global']],
    ['test-write-missing-module-contract-source', ['stage_test_write_x', 'stage_decide_x']],
    ['impl-missing-module-contract-source', ['stage_impl_x', 'stage_decide_x']],
    ['thin-llm-system-prompt', ['stage_x placeholder']],
  ];
  const warnings = withWarnCapture(() => {
    for (const [type, args] of cases) {
      const msg = planCompletenessMsg(type, ...args);
      assert.ok(
        !msg.startsWith('stagent.planCompleteness.'),
        `expected catalog text for ${type}, got raw key: ${msg}`,
      );
      assert.ok(!/\{\d+\}/.test(msg), `unsubstituted placeholder for ${type}: ${msg}`);
    }
  });
  const missing = warnings.filter((w) => w.includes('missing l10n key: stagent.planCompleteness.'));
  assert.deepEqual(missing, [], `unexpected missing-key warnings: ${missing.join(' | ')}`);
});

test('planCompletenessMsg substitutes positional args (explicit + fallback branches)', () => {
  const explicit = planCompletenessMsg('missing-self-heal-chain', 'fix-A；fix-B');
  assert.ok(explicit.includes('fix-A；fix-B'), `explicit arg not substituted: ${explicit}`);

  const fallback = planCompletenessMsg('missing-python-verify-imports', 'tw.py', 'tr');
  assert.ok(
    fallback.includes('tw.py') && fallback.includes('tr'),
    `fallback args not substituted: ${fallback}`,
  );
  assert.ok(!fallback.startsWith('stagent.planCompleteness.'), `raw key returned: ${fallback}`);
});
