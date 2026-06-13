import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildRequirementDoc,
  buildWorkflowPlanDoc,
  buildWorkflowProcessDocs,
  REQUIREMENT_DOC_FILE,
  WORKFLOW_PLAN_DOC_FILE,
} from '../WorkflowProcessDocs';
import type { WorkflowDefinition } from '../WorkflowDefinition';

function makeWorkflow(): WorkflowDefinition {
  return {
    id: 'wf_test',
    version: '2.0',
    meta: {
      title: '数据差异监控脚本',
      taskType: 'prototype',
      userInput: '最终确认的润色后需求文本',
      createdAt: '2026-05-30T00:00:00.000Z',
      taskWorkspacePath: '/tmp/task',
      userInputPolish: {
        originalDraft: '用户最初粘贴的原始草稿',
        polishedAt: '2026-05-30T00:01:00.000Z',
      },
    },
    stages: [
      {
        id: 'stage_decision',
        title: '全局架构决策',
        description: '明确模块边界与接口契约。',
        aiTip: '关注接口一致性。',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [] },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_reader',
        title: '生成 reader.py',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x', writeOutputToFile: 'reader.py' },
        input: { sources: [] },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  } as unknown as WorkflowDefinition;
}

test('buildRequirementDoc 包含原始草稿与最终需求', () => {
  const doc = buildRequirementDoc(makeWorkflow());
  assert.equal(doc.fileName, REQUIREMENT_DOC_FILE);
  assert.match(doc.content, /# 需求分析文档/);
  assert.match(doc.content, /用户最初粘贴的原始草稿/);
  assert.match(doc.content, /最终确认的润色后需求文本/);
  assert.match(doc.content, /数据差异监控脚本/);
});

test('buildRequirementDoc 未润色时给出占位说明', () => {
  const wf = makeWorkflow();
  delete (wf.meta as { userInputPolish?: unknown }).userInputPolish;
  const doc = buildRequirementDoc(wf);
  assert.match(doc.content, /未经过润色/);
});

test('buildWorkflowPlanDoc 列出阶段、工具、决策点与产物', () => {
  const doc = buildWorkflowPlanDoc(makeWorkflow());
  assert.equal(doc.fileName, WORKFLOW_PLAN_DOC_FILE);
  assert.match(doc.content, /# 工作流规划/);
  assert.match(doc.content, /阶段总数：2/);
  assert.match(doc.content, /1\. 全局架构决策/);
  assert.match(doc.content, /决策点/);
  assert.match(doc.content, /人工审核/);
  assert.match(doc.content, /reader\.py/);
  assert.match(doc.content, /审核重点：关注接口一致性。/);
});

test('buildWorkflowProcessDocs 产出两份文档', () => {
  const docs = buildWorkflowProcessDocs(makeWorkflow());
  assert.equal(docs.length, 2);
  assert.deepEqual(
    docs.map((d) => d.fileName),
    [REQUIREMENT_DOC_FILE, WORKFLOW_PLAN_DOC_FILE],
  );
});
