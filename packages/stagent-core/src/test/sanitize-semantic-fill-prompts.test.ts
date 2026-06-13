import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  hasSemanticFillPlanIssues,
  repairImplPromptSingleFileTarget,
  repairTestWritePromptImports,
  sanitizeSemanticFillWorkflow,
} from '../plan-skeleton/sanitizeSemanticFillPrompts';
import { lintMultiFilePromptMismatch } from '../plan-completeness/multiFileImplChecks';
import { lintTestWriteImportPathsInPlan } from '../plan-completeness/testWriteImportChecks';
import { buildRun48LikePlan } from './fixtures/run48PlanShapes';

test('repairImplPromptSingleFileTarget collapses dual backtick paths to writeOutputToFile', () => {
  const prompt =
    '请编写 GREEN 实现，文件路径 `indicators/__init__.py` 或 `indicators/core.py`，遵循规则。';
  const repaired = repairImplPromptSingleFileTarget(prompt, 'indicators/__init__.py');
  assert.match(repaired, /`indicators\/__init__\.py`/);
  assert.doesNotMatch(repaired, /core\.py/);
});

test('repairImplPromptSingleFileTarget collapses broker/main multi-file parens', () => {
  const broker = repairImplPromptSingleFileTarget(
    '请编写 GREEN 实现（`broker/core.py` 和 `broker/sim_broker.py`），遵循规则。',
    'broker/__init__.py',
  );
  assert.match(broker, /`broker\/__init__\.py`/);
  assert.doesNotMatch(broker, /sim_broker/);

  const main = repairImplPromptSingleFileTarget(
    '请编写 GREEN 实现（`main/core.py` 和 `main/cli.py`）：',
    'main.py',
  );
  assert.match(main, /`main\.py`/);
  assert.doesNotMatch(main, /cli\.py/);
});

test('repairTestWritePromptImports replaces your_module placeholder', () => {
  const prompt =
    '仅导入 `from your_module.indicators import compute_indicators, IndicatorResult`。';
  const repaired = repairTestWritePromptImports(prompt, 'indicators');
  assert.match(repaired, /from indicators import compute_indicators/);
  assert.doesNotMatch(repaired, /your_module/);
});

test('repairImplPromptSingleFileTarget collapses prose dual py paths (Run #55 main/cli)', () => {
  const prompt =
    '实现 main/cli.py 和 main/__init__.py（可选）。cli.py 包含 argparse 和主循环逻辑，使用 config.yaml 配置。';
  const repaired = repairImplPromptSingleFileTarget(prompt, 'main/cli.py');
  assert.match(repaired, /main\/cli\.py/);
  assert.doesNotMatch(repaired, /__init__\.py/);
  assert.match(repaired, /config\.yaml/);
});

test('lintMultiFilePromptMismatch ignores config.yaml reference when target is py (Run #55)', () => {
  const stage = {
    id: 'stage_impl_main',
    title: 'impl main',
    tool: 'llm-text' as const,
    toolConfig: {
      type: 'llm-text' as const,
      systemPrompt:
        '实现 main/cli.py。cli.py 包含 argparse，使用 config.yaml 配置。',
      writeOutputToFile: 'main/cli.py',
      writePathBase: 'workspace' as const,
    },
    input: { sources: [], mergeStrategy: 'concat' as const },
    outputs: [{ key: 'code', format: 'text' as const }],
    pauseAfter: false,
  };
  assert.equal(lintMultiFilePromptMismatch(stage), null);
});

test('sanitizeSemanticFillWorkflow clears Run #48 plan completeness blockers (golden fixture)', () => {
  const plan = buildRun48LikePlan();
  assert.equal(hasSemanticFillPlanIssues(plan), true);

  const sanitized = sanitizeSemanticFillWorkflow(plan);
  assert.equal(hasSemanticFillPlanIssues(sanitized), false);

  for (const stage of sanitized.stages ?? []) {
    assert.equal(lintMultiFilePromptMismatch(stage), null);
  }
  const importIssues = lintTestWriteImportPathsInPlan(sanitized).filter(
    (i) => i.type === 'test-write-import-not-in-plan',
  );
  assert.equal(importIssues.length, 0);
});
