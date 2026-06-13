import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { lintArtifactGraphHard } from '../plan-preflight/artifactGraphPreflight';
import { DECISION_ARTIFACTS_OUTPUT_KEY } from '../WorkflowOutputKeys';

function wf(stages: Stage[]): WorkflowDefinition {
  return {
    id: 'wf_ag',
    version: '2.0',
    meta: {
      title: 't',
      taskType: 'software',
      userInput: 'u',
      createdAt: new Date().toISOString(),
    },
    stages,
  };
}

test('lintArtifactGraph blocks file-write when decision lacks decisionArtifacts sidecar contract', () => {
  const issues = lintArtifactGraphHard(
    wf([
      {
        id: 'stage_decide_cfg',
        title: '决策',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'decide' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_write_config',
        title: '写配置',
        tool: 'file-write',
        toolConfig: {
          type: 'file-write',
          filePath: 'config.yaml',
          pathBase: 'workspace',
          sourceStageId: 'stage_decide_cfg',
          sourceOutputKey: 'configContent',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'writeLog', format: 'text' }],
        pauseAfter: false,
      },
    ]),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /artifact-graph-unresolved-key:configContent/);
});

test('lintArtifactGraph allows virtual sidecar keys when decisionArtifacts output declared', () => {
  const issues = lintArtifactGraphHard(
    wf([
      {
        id: 'stage_decide_cfg',
        title: '决策',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'decide' },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [
          { key: 'decisionRecord', format: 'markdown' },
          { key: DECISION_ARTIFACTS_OUTPUT_KEY, format: 'json' },
        ],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_write_config',
        title: '写配置',
        tool: 'file-write',
        toolConfig: {
          type: 'file-write',
          filePath: 'config.yaml',
          pathBase: 'workspace',
          sourceStageId: 'stage_decide_cfg',
          sourceOutputKey: 'configContent',
        },
        input: { sources: [], mergeStrategy: 'concat' },
        outputs: [{ key: 'writeLog', format: 'text' }],
        pauseAfter: false,
      },
    ]),
  );
  assert.deepEqual(issues, []);
});
