/**
 * SKILLS-MAPPING.md §2（grill-me → questionBefore / questionAfter）最小回归清单（代码锁）
 *
 * 已锁定（本产品口径，与 §2「差距风险」一致）：
 * - [x] questionAfter：`paused` + 工作流定义中的 `questionAfter[]` → 同屏多题、单次提交 `answerQuestions`（SPEC §11 批量协议）。
 * - [x] questionBefore：`waiting-questions` + `stageQuestionsBefore` → 同屏多题、单次提交 `answerQuestionsBefore`。
 * - [x] `hint` 映射到输入框 `placeholder`（§2 推荐答案占位；无 hint 时脚本使用兜底文案）。
 *
 * 刻意不覆盖（上游 SKILL 要求，需协议/里程碑另议）：
 * - [ ] 「每次只展示一题、逐题等待反馈」——需游标状态 / 协议索引（§2 协议与实现备注）。
 * - [ ] 「能探索代码库则必须探索并预填」——当前仅靠 hint/模型侧行为，无可结构性断言。
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  collectTextInputs,
  findButtonByText,
  type MiniElement,
  setupWebviewScriptRuntime,
} from './webview-script-test-harness';

/** 脚本里答案写在 input.oninput；Mini DOM 不会自动触发，测试里手动刷新一次。 */
function commitTextInputValues(inputs: MiniElement[]): void {
  for (const el of inputs) {
    el.oninput?.();
  }
}

/** vm 上下文 postMessage 的对象与宿主字面量 deepEqual 可能因 realm 失败，复制为普通对象再断言。 */
function plainRecord(r: Record<string, string>): Record<string, string> {
  return { ...r };
}

const meta = {
  title: 'grill-contract',
  taskType: 'software',
  userInput: 'x',
  createdAt: new Date().toISOString(),
} as const;

test('§2 contract: questionAfter — multi-field screen + single answerQuestions batch', () => {
  const rt = setupWebviewScriptRuntime(true);
  const workflow = {
    id: 'wf_grill_q_after',
    version: '2.0',
    meta,
    stages: [
      {
        id: 'stage_impl_x',
        title: 'impl',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionAfter: [
          { id: 'q_a', text: 'Q1?', hint: 'hint-a', required: true },
          { id: 'q_b', text: 'Q2?', hint: 'hint-b', required: true },
          { id: 'q_c', text: 'Q3?', hint: 'hint-c', required: false },
        ],
      },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_impl_x', status: 'paused' });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const inputs = collectTextInputs(pauseBar);
  assert.equal(inputs.length, 3);
  assert.equal(inputs[0].placeholder, 'hint-a');
  assert.equal(inputs[1].placeholder, 'hint-b');
  assert.equal(inputs[2].placeholder, 'hint-c');

  inputs[0].value = 'A1';
  inputs[1].value = 'A2';
  inputs[2].value = 'A3';
  commitTextInputValues(inputs);

  findButtonByText(pauseBar, '提交答案并继续').onclick?.();

  const msg = rt.postMessages.find((m) => (m as { type?: string }).type === 'answerQuestions') as
    | { type: 'answerQuestions'; stageId: string; answers: Record<string, string> }
    | undefined;
  assert.ok(msg);
  assert.equal(msg.stageId, 'stage_impl_x');
  assert.deepEqual(plainRecord(msg.answers), { q_a: 'A1', q_b: 'A2', q_c: 'A3' });
});

test('§2 contract: questionAfter — stageQuestions payload re-renders same batch UI', () => {
  const rt = setupWebviewScriptRuntime(true);
  const qs = [
    { id: 'x1', text: 'T1', hint: 'h1', required: true },
    { id: 'x2', text: 'T2', hint: 'h2', required: true },
  ];
  const workflow = {
    id: 'wf_grill_q_after_msg',
    version: '2.0',
    meta,
    stages: [
      {
        id: 'stage_impl_z',
        title: 'impl z',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionAfter: qs,
      },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({ type: 'stageStatusUpdate', stageId: 'stage_impl_z', status: 'paused' });
  rt.send({ type: 'stageQuestions', stageId: 'stage_impl_z', questions: qs });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  assert.equal(collectTextInputs(pauseBar).length, 2);
});

test('§2 contract: questionBefore — waiting-questions + stageQuestionsBefore batch submit', () => {
  const rt = setupWebviewScriptRuntime(true);
  const questionBefore = [
    { id: 'b1', text: 'BQ1', hint: 'bh1', required: true },
    { id: 'b2', text: 'BQ2', hint: 'bh2', required: true },
  ];
  const workflow = {
    id: 'wf_grill_q_before',
    version: '2.0',
    meta,
    stages: [
      {
        id: 'stage_impl_y',
        title: 'impl y',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: 'u' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: true,
        questionBefore,
      },
    ],
  };

  rt.send({ type: 'workflowGenerated', workflow, warnings: [] });
  rt.send({
    type: 'stageStatusUpdate',
    stageId: 'stage_impl_y',
    status: 'waiting-questions',
    isDecisionStage: false,
  });
  rt.send({
    type: 'stageQuestionsBefore',
    stageId: 'stage_impl_y',
    questions: questionBefore,
  });

  const pauseBar = rt.document.getElementById('pause-bar');
  assert.ok(pauseBar);
  const inputs = collectTextInputs(pauseBar);
  assert.equal(inputs.length, 2);
  inputs[0].value = 'RB1';
  inputs[1].value = 'RB2';
  commitTextInputValues(inputs);

  findButtonByText(pauseBar, '开始执行').onclick?.();

  const msg = rt.postMessages.find((m) => (m as { type?: string }).type === 'answerQuestionsBefore') as
    | { type: 'answerQuestionsBefore'; stageId: string; answers: Record<string, string> }
    | undefined;
  assert.ok(msg);
  assert.equal(msg.stageId, 'stage_impl_y');
  assert.deepEqual(plainRecord(msg.answers), { b1: 'RB1', b2: 'RB2' });
});
