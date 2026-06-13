#!/usr/bin/env node
/* ------------------------------------------------------------------ */
/*  skill-grill-smoke — 用 DeepSeek(OpenAI 兼容) API 端到端验证          */
/*  grill skill 的 native 化（替代无法在无头环境跑的 Electron GUI）。     */
/*                                                                     */
/*  做什么：                                                            */
/*   1. SkillRegistry 从 skills 根加载 grill-with-docs 的 SKILL.md 原文  */
/*   2. SkillPromptAssembler 组装 systemPrompt（原文 + Context Bundle +  */
/*      升级闸门）                                                       */
/*   3. 调 DeepSeek /v1/chat/completions，打印模型按 grill 纪律给出的     */
/*      「一次一个问题」                                                 */
/*                                                                     */
/*  运行（需先 `npm run build:core`）：                                  */
/*    DEEPSEEK_API_KEY=sk-xxx \                                         */
/*    node packages/stagent-core/scripts/skill-grill-smoke.mjs "做一个任务看板" */
/*                                                                     */
/*  可选环境变量：                                                      */
/*    SKILLS_ROOT     skills 根（默认 <repo>/skills-main-lastest/skills）*/
/*    DEEPSEEK_BASE_URL（默认 https://api.deepseek.com/v1）             */
/*    DEEPSEEK_MODEL  （默认 deepseek-chat）                            */
/* ------------------------------------------------------------------ */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SkillRegistry,
  assembleSkillSystemPrompt,
  SKILL_GRILL_WITH_DOCS,
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveSkillsRoot() {
  if (process.env.SKILLS_ROOT) {
    return process.env.SKILLS_ROOT;
  }
  // scripts → stagent-core → packages → autoAI → <repo>/skills-main-lastest/skills
  return path.resolve(__dirname, '../../../../skills-main-lastest/skills');
}

async function main() {
  const userTask = process.argv.slice(2).join(' ').trim() || '做一个任务看板，支持拖拽改状态，要有权限控制';
  // 兼容多种密钥变量名（Cursor Secret 名为 `deepseek` 时直接命中，无需远程改名）
  const apiKey =
    process.env.DEEPSEEK_API_KEY ||
    process.env.deepseek ||
    process.env.DEEPSEEK ||
    process.env.LLM_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const skillsRoot = resolveSkillsRoot();

  const reg = new SkillRegistry({ skillsRoot });
  const count = reg.load();
  console.log(`[skill-grill-smoke] skillsRoot=${skillsRoot} loaded=${count}`);
  const skill = reg.get(SKILL_GRILL_WITH_DOCS);
  if (!skill) {
    console.error(
      `[skill-grill-smoke] 未找到 ${SKILL_GRILL_WITH_DOCS}（list=${reg.list().join(', ') || '空'}）。请用 SKILLS_ROOT 指定 skills 根。`,
    );
    process.exit(2);
  }
  console.log(`[skill-grill-smoke] skill=${skill.ref} version=${skill.version} category=${skill.category ?? '-'}`);

  const systemPrompt = assembleSkillSystemPrompt(skill, {
    userTask,
    charter: '优先：简单可维护、复用现有方案。避免：引入新一等公民概念。约束：数据不出中国大陆。',
    autoAnswerMode: 'suggest',
    repoSnapshot: 'isGreenfield=true（空仓库）',
  });

  if (!apiKey) {
    console.log('\n[skill-grill-smoke] 未设置 DEEPSEEK_API_KEY → 跳过真实 LLM 调用（dry-run）。');
    console.log('  组装出的 systemPrompt 预览（前 600 字）：\n');
    console.log(systemPrompt.slice(0, 600));
    console.log('\n  在 Cursor Dashboard (Cloud Agents > Secrets) 添加 DEEPSEEK_API_KEY 后即可端到端运行。');
    return;
  }

  console.log('\n[skill-grill-smoke] 调 DeepSeek …\n');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userTask },
      ],
      temperature: 0.3,
      stream: false,
    }),
  });
  if (!res.ok) {
    console.error(`[skill-grill-smoke] HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  const reply = json?.choices?.[0]?.message?.content ?? '(空)';
  console.log('=== grill (DeepSeek) 输出 ===\n');
  console.log(reply);
}

main().catch((e) => {
  console.error('[skill-grill-smoke] 失败:', e?.message ?? e);
  process.exit(1);
});
