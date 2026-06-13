#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  skill-grill-ab — grill「编译版 baseline」vs「原版 SKILL.md」A/B        */
/*                                                                     */
/*  目的（SKILLS-ENGINE-INTEGRATION.md §11）：用数据回答「原版 skill 是否   */
/*  更好」。同一任务分别用：                                              */
/*   A) compiled-baseline：一句话内化指令（代表引擎「编译进规则」的版本）  */
/*   B) native：注入原版 grill-with-docs SKILL.md（本 PR 的 native 化）    */
/*  对比模型按 grill 纪律提问的质量（是否一次一问、是否带推荐答案、是否     */
/*  挑战术语/挖盲区）。                                                  */
/*                                                                     */
/*  运行（需 `npm run build:core` + DeepSeek key；新 agent VM 注入 deepseek）：*/
/*    node packages/stagent-core/scripts/skill-grill-ab.mjs "做一个任务看板" */
/* ------------------------------------------------------------------ */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillRegistry, assembleSkillSystemPrompt, SKILL_GRILL_WITH_DOCS } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPILED_BASELINE = [
  '你是需求对齐助手。请就用户的开发计划向用户提出澄清问题，帮助厘清需求后再开始实现。',
  '尽量覆盖关键点。',
].join('\n');

function resolveSkillsRoot() {
  return (
    process.env.SKILLS_ROOT || path.resolve(__dirname, '../../../../skills-main-lastest/skills')
  );
}

function getApiKey() {
  return (
    process.env.DEEPSEEK_API_KEY ||
    process.env.deepseek ||
    process.env.DEEPSEEK ||
    process.env.LLM_API_KEY
  );
}

async function callDeepseek({ system, user, apiKey, baseUrl, model }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '(空)';
}

/** 极简启发式指标（供快速对比；非权威评测）。 */
function metrics(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const questionLines = lines.filter((l) => /[?？]/.test(l));
  const hasRecommendation = /推荐|建议|recommend|默认|default/i.test(text);
  const challengesTerms = /术语|定义|歧义|是否指|你说的.*是指|terminology|ambiguous/i.test(text);
  return {
    chars: text.length,
    questionCount: questionLines.length,
    oneAtATime: questionLines.length <= 2,
    hasRecommendation,
    challengesTerms,
  };
}

async function main() {
  const userTask =
    process.argv.slice(2).join(' ').trim() || '做一个任务看板，支持拖拽改状态，要有权限控制';
  const apiKey = getApiKey();
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  const reg = new SkillRegistry({ skillsRoot: resolveSkillsRoot() });
  reg.load();
  const skill = reg.get(SKILL_GRILL_WITH_DOCS);
  if (!skill) {
    console.error('[ab] 未找到 grill-with-docs；用 SKILLS_ROOT 指定 skills 根。');
    process.exit(2);
  }
  const nativeSystem = assembleSkillSystemPrompt(skill, { userTask, autoAnswerMode: 'suggest' });

  if (!apiKey) {
    console.log('[ab] 未设置 DeepSeek key → dry-run（仅展示两侧 systemPrompt 长度）。');
    console.log(`  A compiled-baseline: ${COMPILED_BASELINE.length} chars`);
    console.log(`  B native(SKILL.md):  ${nativeSystem.length} chars (skill v${skill.version})`);
    console.log('  在新 Cloud Agent VM（注入 deepseek）中运行即可得到真实 A/B 输出与指标。');
    return;
  }

  console.log(`[ab] task="${userTask}" model=${model}\n`);
  const [a, b] = await Promise.all([
    callDeepseek({ system: COMPILED_BASELINE, user: userTask, apiKey, baseUrl, model }),
    callDeepseek({ system: nativeSystem, user: userTask, apiKey, baseUrl, model }),
  ]);

  console.log('=== A) compiled-baseline ===\n');
  console.log(a);
  console.log('\n=== B) native (grill-with-docs SKILL.md) ===\n');
  console.log(b);
  console.log('\n=== 启发式指标对比 ===');
  console.table({ 'A compiled': metrics(a), 'B native': metrics(b) });
}

main().catch((e) => {
  console.error('[ab] 失败:', e?.message ?? e);
  process.exit(1);
});
