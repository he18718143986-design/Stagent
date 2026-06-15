import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage } from '../WorkflowDefinition';
import {
  injectSmokeStage,
  isSmokeStageId,
  SMOKE_FIX_STAGE_ID,
  SMOKE_RUN_STAGE_ID,
} from '../disk-bootstrap/smokeStage';
import { DELIVERY_WRAPUP_STAGE_ID } from '../disk-bootstrap/deliveryWrapupStage';
import { CODE_RUNNER_EXIT_OUTPUT_KEY, VERIFY_OUT_OUTPUT_KEY } from '../WorkflowOutputKeys';

function llmStage(id: string, file: string): Stage {
  return {
    id,
    title: id,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: file },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

function fileWriteStage(id: string, filePath: string): Stage {
  return {
    id,
    title: id,
    tool: 'file-write',
    toolConfig: {
      type: 'file-write',
      filePath,
      pathBase: 'workspace',
      sourceOutputKey: 'configContent',
    },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

test('injectSmokeStage Python main.py CLI → one-shot（非 serve），跑主入口 + 断言产出（ADR-0008）', () => {
  const stages = [
    llmStage('stage_impl_main', 'main.py'),
    fileWriteStage('stage_write_config', 'config.yaml'),
    llmStage(DELIVERY_WRAPUP_STAGE_ID, 'DELIVERY.md'),
  ];
  const injected = injectSmokeStage(stages);
  const smoke = injected.find((s) => s.id === SMOKE_RUN_STAGE_ID);
  assert.ok(smoke);
  // 新 id 复用 test_run 自修复机制
  assert.equal(SMOKE_RUN_STAGE_ID, 'stage_test_run_smoke');
  assert.ok(isSmokeStageId(SMOKE_RUN_STAGE_ID));
  const cfg = smoke!.toolConfig;
  assert.equal(cfg.type, 'code-runner');
  if (cfg.type === 'code-runner') {
    // 先跑主入口，再追加产出断言脚本（&& node verify-smoke-output.mjs）
    assert.ok(cfg.command.startsWith('.venv/bin/python main.py --config config.yaml'));
    assert.match(cfg.command, /&&\s+node\b/);
    assert.match(cfg.command, /verify-smoke-output\.mjs/);
    assert.notEqual(cfg.serve, true);
  }
  // smoke 输出键为 verifyOut，供配对 fix 阶段读取
  assert.ok(smoke!.outputs?.some((o) => o.key === VERIFY_OUT_OUTPUT_KEY));
});

test('injectSmokeStage one-shot 注入配对 fix 阶段（失败走 fix 链，skipIf=exitCodeZero）', () => {
  const stages = [
    llmStage('stage_impl_main', 'main.py'),
    fileWriteStage('stage_write_config', 'config.yaml'),
    llmStage(DELIVERY_WRAPUP_STAGE_ID, 'DELIVERY.md'),
  ];
  const injected = injectSmokeStage(stages);
  const fix = injected.find((s) => s.id === SMOKE_FIX_STAGE_ID);
  assert.ok(fix, 'should inject stage_fix_if_failed_smoke');
  assert.equal(fix!.tool, 'llm-text');
  // fix 写回主入口
  if (fix!.toolConfig.type === 'llm-text') {
    assert.equal(fix!.toolConfig.writeOutputToFile, 'main.py');
  }
  // skipIf：smoke exit 0 时跳过修复
  assert.equal(fix!.skipIf?.type, 'exitCodeZero');
  assert.equal(fix!.skipIf?.stageId, SMOKE_RUN_STAGE_ID);
  assert.equal(fix!.skipIf?.outputKey, CODE_RUNNER_EXIT_OUTPUT_KEY);
  // 顺序：smoke → fix → delivery
  const ids = injected.map((s) => s.id);
  assert.ok(ids.indexOf(SMOKE_RUN_STAGE_ID) < ids.indexOf(SMOKE_FIX_STAGE_ID));
  assert.ok(ids.indexOf(SMOKE_FIX_STAGE_ID) < ids.indexOf(DELIVERY_WRAPUP_STAGE_ID));
});

test('injectSmokeStage Python server.py → serve 模式（长驻探活），不断言产出、无 fix 阶段', () => {
  const stages = [
    llmStage('stage_impl_server', 'server.py'),
    llmStage(DELIVERY_WRAPUP_STAGE_ID, 'DELIVERY.md'),
  ];
  const injected = injectSmokeStage(stages);
  const smoke = injected.find((s) => s.id === SMOKE_RUN_STAGE_ID);
  assert.ok(smoke);
  const cfg = smoke!.toolConfig;
  assert.equal(cfg.type, 'code-runner');
  if (cfg.type === 'code-runner') {
    assert.equal(cfg.command, '.venv/bin/python server.py');
    assert.equal(cfg.serve, true);
  }
  // serve 模式不接产出断言/fix 链
  assert.equal(injected.find((s) => s.id === SMOKE_FIX_STAGE_ID), undefined);
});

test('injectSmokeStage 幂等：已存在历史 stage_smoke_run 不再注入', () => {
  const stages: Stage[] = [
    llmStage('stage_impl_main', 'main.py'),
    {
      id: 'stage_smoke_run',
      title: 'serve smoke',
      tool: 'code-runner',
      toolConfig: {
        type: 'code-runner',
        command: 'npm start',
        serve: true,
        captureOutput: true,
        pathBase: 'workspace',
      },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'out', format: 'text' }],
      pauseAfter: false,
    },
    llmStage(DELIVERY_WRAPUP_STAGE_ID, 'DELIVERY.md'),
  ];
  const injected = injectSmokeStage(stages);
  assert.equal(injected.length, stages.length);
  assert.equal(injected.find((s) => s.id === SMOKE_RUN_STAGE_ID), undefined);
});
