import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import {
  appendGlobalDecisionContextToSystemPrompt,
  buildGlobalDecisionSystemPromptBlock,
  collectApprovedDecisionSnippets,
  decisionStageIdsAlreadyInSources,
  filterSnippetsNotAlreadySourced,
  formatGlobalDecisionContextBlock,
  GLOBAL_DECISION_SUMMARY_MAX_CHARS_PER_RECORD,
  shouldInjectGlobalDecisionContext,
  summarizeDecisionRecord,
} from '../GlobalDecisionContext';

function makeStage(partial: Partial<Stage> & Pick<Stage, 'id' | 'title'>): Stage {
  const { id, title, ...rest } = partial;
  return {
    id,
    title,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
    ...rest,
  };
}

test('collectApprovedDecisionSnippets includes all done decisions except current stage', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { userInput: 'x', taskType: 'software', title: 't', createdAt: '2026-01-01T00:00:00.000Z' },
    stages: [
      makeStage({ id: 'stage_decide_a', title: 'A', isDecisionStage: true }),
      makeStage({ id: 'stage_impl_a', title: 'Impl A' }),
      makeStage({ id: 'stage_decide_b', title: 'B', isDecisionStage: true }),
      makeStage({ id: 'stage_impl_b', title: 'Impl B' }),
    ],
  };
  const runtimes = [
    { stageId: 'stage_decide_a', status: 'done' as const, outputs: { decisionRecord: 'DR-A' }, retryCount: 0 },
    { stageId: 'stage_impl_a', status: 'done' as const, outputs: {}, retryCount: 0 },
    { stageId: 'stage_decide_b', status: 'done' as const, outputs: { decisionRecord: 'DR-B' }, retryCount: 0 },
    { stageId: 'stage_impl_b', status: 'pending' as const, outputs: {}, retryCount: 0 },
  ];
  const snippets = collectApprovedDecisionSnippets(definition, runtimes, 'stage_impl_b');
  assert.equal(snippets.length, 2);
  assert.deepEqual(
    snippets.map((s) => s.stageId),
    ['stage_decide_a', 'stage_decide_b'],
  );
});

test('collectApprovedDecisionSnippets excludes paused undecided stages', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { userInput: 'x', taskType: 'software', title: 't', createdAt: '2026-01-01T00:00:00.000Z' },
    stages: [
      makeStage({ id: 'stage_decide_a', title: 'A', isDecisionStage: true }),
      makeStage({ id: 'stage_impl_a', title: 'Impl A' }),
    ],
  };
  const runtimes = [
    { stageId: 'stage_decide_a', status: 'done' as const, outputs: { decisionRecord: 'DR-A' }, retryCount: 0 },
    { stageId: 'stage_impl_a', status: 'pending' as const, outputs: {}, retryCount: 0 },
  ];
  assert.equal(collectApprovedDecisionSnippets(definition, runtimes, 'stage_impl_a').length, 1);
});

test('filterSnippetsNotAlreadySourced skips explicit decisionRecord sources', () => {
  const snippets = [
    { stageId: 'stage_decide_a', title: 'A', record: 'DR-A' },
    { stageId: 'stage_decide_b', title: 'B', record: 'DR-B' },
  ];
  const sources = [
    {
      type: 'stage-output' as const,
      stageId: 'stage_decide_a',
      outputKey: 'decisionRecord',
      label: '已确认决策',
    },
  ];
  assert.deepEqual(decisionStageIdsAlreadyInSources(sources), new Set(['stage_decide_a']));
  const filtered = filterSnippetsNotAlreadySourced(snippets, sources);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].stageId, 'stage_decide_b');
});

test('formatGlobalDecisionContextBlock summary mode truncates long records', () => {
  const long = 'x'.repeat(GLOBAL_DECISION_SUMMARY_MAX_CHARS_PER_RECORD + 500);
  const text = formatGlobalDecisionContextBlock(
    [{ stageId: 'stage_decide_x', title: '模块 X', record: long }],
    'summary',
  );
  assert.match(text, /已批准的全局决策摘要/);
  assert.match(text, /截断/);
  assert.ok(text.length < long.length);
});

test('formatGlobalDecisionContextBlock full mode keeps full text', () => {
  const text = formatGlobalDecisionContextBlock(
    [{ stageId: 'stage_decide_x', title: '模块 X', record: '### 职责边界\n- x' }],
    'full',
  );
  assert.match(text, /已批准的全局决策上下文/);
  assert.match(text, /职责边界/);
});

test('appendGlobalDecisionContextToSystemPrompt appends block after separator', () => {
  const out = appendGlobalDecisionContextToSystemPrompt('你是工程师。', '## 摘要\n- a');
  assert.match(out, /你是工程师。\n\n---\n\n## 摘要/);
  assert.equal(appendGlobalDecisionContextToSystemPrompt('base', ''), 'base');
});

test('buildGlobalDecisionSystemPromptBlock returns null when disabled', () => {
  const definition: WorkflowDefinition = {
    id: 'wf',
    version: '2.0',
    meta: { userInput: 'x', taskType: 'software', title: 't', createdAt: '2026-01-01T00:00:00.000Z' },
    stages: [
      makeStage({ id: 'stage_decide_a', title: 'A', isDecisionStage: true }),
      makeStage({ id: 'stage_impl_a', title: 'Impl A' }),
    ],
  };
  const runtimes = [
    { stageId: 'stage_decide_a', status: 'done' as const, outputs: { decisionRecord: 'DR-A' }, retryCount: 0 },
    { stageId: 'stage_impl_a', status: 'pending' as const, outputs: {}, retryCount: 0 },
  ];
  const impl = definition.stages[1];
  assert.equal(
    buildGlobalDecisionSystemPromptBlock(definition, runtimes, impl, {
      vscodeInjectEnabled: false,
      mode: 'summary',
    }),
    null,
  );
  const block = buildGlobalDecisionSystemPromptBlock(definition, runtimes, impl, {
    vscodeInjectEnabled: true,
    mode: 'summary',
  });
  assert.match(block ?? '', /DR-A/);
});

test('shouldInjectGlobalDecisionContext respects flags and stage kind', () => {
  const impl = makeStage({ id: 'stage_impl_x', title: 'Impl' });
  const decide = makeStage({ id: 'stage_decide_x', title: 'Decide', isDecisionStage: true });
  assert.equal(shouldInjectGlobalDecisionContext(impl, undefined, true), true);
  assert.equal(shouldInjectGlobalDecisionContext(impl, false, true), false);
  assert.equal(shouldInjectGlobalDecisionContext(decide, undefined, true), false);
});

test('summarizeDecisionRecord leaves short text unchanged', () => {
  assert.equal(summarizeDecisionRecord('short'), 'short');
});
