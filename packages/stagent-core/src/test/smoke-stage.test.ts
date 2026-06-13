import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage } from '../WorkflowDefinition';
import { injectSmokeStage, SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import { DELIVERY_WRAPUP_STAGE_ID } from '../disk-bootstrap/deliveryWrapupStage';

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

test('injectSmokeStage Python main.py CLI → one-shot（非 serve），exit 0=通过（Run #58）', () => {
  const stages = [
    llmStage('stage_impl_main', 'main.py'),
    fileWriteStage('stage_write_config', 'config.yaml'),
    llmStage(DELIVERY_WRAPUP_STAGE_ID, 'DELIVERY.md'),
  ];
  const injected = injectSmokeStage(stages);
  const smoke = injected.find((s) => s.id === SMOKE_RUN_STAGE_ID);
  assert.ok(smoke);
  const cfg = smoke!.toolConfig;
  assert.equal(cfg.type, 'code-runner');
  if (cfg.type === 'code-runner') {
    assert.equal(cfg.command, '.venv/bin/python main.py --config config.yaml');
    assert.notEqual(cfg.serve, true);
  }
});

test('injectSmokeStage Python server.py → serve 模式（长驻探活）', () => {
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
});
