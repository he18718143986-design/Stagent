import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { GATE_ID_CONFIG_CONTRACT_POST_IMPL } from '../QualityGateIds';
import { BUILTIN_POST_STAGE_GATES } from '../quality-gates/postStageGates';
import { buildConfigYamlBridgePromptSuffix } from '../stage-runners/llm-persist/testImportBridgePromptSuffix';
import { GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID } from '../workflow/StageIdPatterns';

const CONFIG_GATE = BUILTIN_POST_STAGE_GATES.find((g) => g.id === GATE_ID_CONFIG_CONTRACT_POST_IMPL)!;

function makeInstance(mainPy: string): WorkflowInstance {
  const impl: Stage = {
    id: 'stage_impl_main',
    title: 'impl main',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'main.py' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'code', format: 'text' }],
    pauseAfter: false,
  };
  return {
    status: 'running',
    definition: {
      id: 'wf',
      version: '2.0',
      meta: { title: 't', taskType: 'software', userInput: 'u', createdAt: new Date().toISOString() },
      stages: [impl],
    },
    stageRuntimes: [
      {
        stageId: GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
        status: 'done',
        outputs: {
          decisionArtifacts: {
            version: 1,
            files: [
              {
                key: 'configContent',
                path: 'config.yaml',
                format: 'yaml',
                content: 'kline_path: data/test.csv\nbroker:\n  sim: true\n',
              },
            ],
          },
        },
        retryCount: 0,
      },
      {
        stageId: 'stage_impl_main',
        status: 'done',
        outputs: { code: mainPy },
        retryCount: 0,
      },
    ],
    currentStageIndex: 0,
  };
}

test('config-contract-post-impl gate blocks invented config key on main.py', async () => {
  const mainPy = `
import yaml
def load_config(p):
    with open(p) as f:
        return yaml.safe_load(f)
def main():
    config = load_config('config.yaml')
    x = config['data']
`;
  const instance = makeInstance(mainPy);
  const stage = instance.definition.stages[0]!;
  const rt = instance.stageRuntimes[1]!;
  const result = await CONFIG_GATE.evaluate({
    phase: 'post-stage',
    workflow: instance.definition,
    stage,
    stageIndex: 0,
    stageRuntime: rt,
    instance,
    instanceKey: 'k',
    taskWorkspaceAbs: undefined,
    executionHost: undefined,
  });
  assert.ok(result);
  assert.equal(result!.severity, 'block');
  assert.match(result!.messages[0]!, /'data'/);
  assert.match(result!.messages[0]!, /未定义该键/);
});

test('buildConfigYamlBridgePromptSuffix lists allowed keys from architecture artifacts', () => {
  const suffix = buildConfigYamlBridgePromptSuffix(
    makeInstance('').stageRuntimes,
    'main.py',
  );
  assert.ok(suffix);
  assert.match(suffix!, /kline_path/);
  assert.match(suffix!, /禁止发明/);
  assert.match(suffix!, /cfg\['broker'\]/);
  assert.match(suffix!, /trade/);
});
