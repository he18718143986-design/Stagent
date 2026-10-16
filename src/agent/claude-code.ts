/**
 * Claude Code 适配器（规格 §8）：用 @anthropic-ai/claude-agent-sdk 的 query() 驱动 Claude Code。
 *
 * 合同（SDK 0.3.x 调研结论，见 docs/agent.md「SDK 合同」）：
 * - cwd = 项目根目录；settingSources: ['project'] 让 .claude/settings.json 里的 PreToolUse 守卫 hook 生效；
 * - 实现 / 修复：permissionMode 'acceptEdits'，允许 Bash（守卫拦危险命令）；
 * - 起草例子：同上，但不给 Bash，守卫只对本会话放行 .stagent/checks/draft/**；
 * - 只读任务（分类、计划、归属、扫描、记录、问答）：permissionMode 'dontAsk' + allowedTools 只读工具，
 *   未预先允许的工具一律拒绝；
 * - 会话 id：每条消息都带 session_id；中断后用 options.resume 续接；
 * - 用量：result 消息的 total_cost_usd、usage.input_tokens / output_tokens、modelUsage 的键是模型名；
 * - 费用上限：options.maxBudgetUsd，超出时 result.subtype = 'error_max_budget_usd'。
 *
 * AI 输出只是"声称"：本模块只返回文本与解析结果，不写账本（Invariant 1）。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FileAttribution, PlanStep, RecordKind, Track } from '../ledger/types.js';
import { extractJson, parseClaimReport, REPORT_FORMAT } from './report.js';
import type {
  AgentAvailability,
  AgentContext,
  AgentExecutor,
  AgentOutcome,
  AgentUsage,
  AttributeFilesInput,
  Classification,
  ClaimReport,
  ClassifyInput,
  DecisionQuestionInput,
  DraftedExample,
  DraftedPlan,
  DraftedRecord,
  DraftedRule,
  DraftExamplesInput,
  DraftPlanInput,
  DraftRecordsInput,
  DraftRuleInput,
  FeatureBrief,
  FixInput,
  ImplementInput,
  ScannedFeature,
} from './types.js';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];

export class AgentRunError extends Error {
  override name = 'AgentRunError';
  constructor(
    message: string,
    readonly usage: AgentUsage | null,
    readonly sessionId: string | null,
    readonly budgetExceeded = false,
  ) {
    super(message);
  }
}

type Mode = 'readonly' | 'draft' | 'edit';

interface QueryResult {
  text: string;
  usage: AgentUsage | null;
  sessionId: string | null;
}

/** query() 的最小形状：只用到这些字段，避免把 SDK 的全部类型带进核心。 */
type QueryFn = (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;

export interface ClaudeCodeOptions {
  /** 测试注入：替代 SDK 的 query()。 */
  queryFn?: QueryFn;
  model?: string;
}

export class ClaudeCodeExecutor implements AgentExecutor {
  readonly name = 'claude-code';

  constructor(private readonly options: ClaudeCodeOptions = {}) {}

  async availability(): Promise<AgentAvailability> {
    if (process.env.STAGENT_AGENT === 'off') {
      return { available: false, reason: 'Claude Code 已被关闭（STAGENT_AGENT=off）', hint: '去掉环境变量 STAGENT_AGENT=off 后重启 stagent' };
    }
    if (!this.options.queryFn) {
      try {
        await import('@anthropic-ai/claude-agent-sdk');
      } catch {
        return { available: false, reason: '未安装 Claude Agent SDK', hint: 'npm install @anthropic-ai/claude-agent-sdk' };
      }
    }
    const loggedIn =
      !!process.env.ANTHROPIC_API_KEY ||
      !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      !!process.env.CLAUDE_CODE_USE_BEDROCK ||
      !!process.env.CLAUDE_CODE_USE_VERTEX ||
      existsSync(join(homedir(), '.claude', '.credentials.json')) ||
      existsSync(join(homedir(), '.claude.json'));
    if (!loggedIn) {
      return { available: false, reason: 'Claude Code 未登录', hint: '运行 claude 并完成 /login，或设置环境变量 ANTHROPIC_API_KEY' };
    }
    return { available: true };
  }

  async classifyChange(input: ClassifyInput, ctx: AgentContext): Promise<AgentOutcome<Classification>> {
    const r = await this.run(
      `你在帮 Stagent 判断一次改动的档位。只读分析，不要修改任何文件。

改动描述：${input.description}

已有功能（featureId · 名称 · 状态 · 主要文件）：
${briefs(input.features)}

系统地图摘要：
${input.systemMap || '（暂无）'}

规则：只要会新增或改变用户可见行为，就判为 feature（新功能档），否则 small（小改动档）。
targetFeatureIds 是这次改动预计会触及的已有功能（可为空）。需求会触及 ≥ 2 个功能，或预计需要 ≥ 2 次独立验收时，suggestPlan 为 true。

只输出一个 JSON 代码块：
\`\`\`json
{"track":"small|feature","targetFeatureIds":["..."],"suggestPlan":false,"rationale":"一句话理由"}
\`\`\``,
      'readonly',
      ctx,
    );
    const j = obj(extractJson(r.text));
    const known = new Set(input.features.map((f) => f.featureId));
    return {
      ...r,
      value: {
        track: j.track === 'feature' ? 'feature' : 'small',
        targetFeatureIds: strings(j.targetFeatureIds).filter((id) => known.has(id)),
        suggestPlan: j.suggestPlan === true,
        rationale: str(j.rationale),
      },
    };
  }

  async draftPlan(input: DraftPlanInput, ctx: AgentContext): Promise<AgentOutcome<DraftedPlan>> {
    const r = await this.run(
      `把下面这个大需求拆成 2–8 个有序步骤。只读分析，不要修改任何文件。

需求：${input.requirement}

已有功能：
${briefs(input.features)}

系统地图（.stagent/docs/system-map.md）：
${input.systemMap || '（暂无）'}

每一步合并后系统都应处于可用状态，且能用 1–4 个例子验收。每步写清 intent（做什么，大白话）、track（small 或 feature）、
featureIds（涉及的已有功能 id，可为空）、dependsOn（依赖的前置步骤 stepId）。stepId 用 s1、s2……。

只输出一个 JSON 代码块：
\`\`\`json
{"rationale":"为什么这样拆","steps":[{"stepId":"s1","title":"…","intent":"…","track":"feature","featureIds":[],"dependsOn":[]}]}
\`\`\``,
      'readonly',
      ctx,
    );
    const j = obj(extractJson(r.text));
    const steps = (Array.isArray(j.steps) ? j.steps : []).map((s, i): PlanStep => {
      const o = obj(s);
      return {
        stepId: str(o.stepId) || `s${i + 1}`,
        title: str(o.title) || `第 ${i + 1} 步`,
        intent: str(o.intent),
        track: (o.track === 'small' ? 'small' : 'feature') as Track,
        featureIds: strings(o.featureIds),
        dependsOn: strings(o.dependsOn),
      };
    });
    if (steps.length === 0) throw new AgentRunError('AI 没有给出计划步骤', r.usage, r.sessionId);
    return { ...r, value: { steps, rationale: str(j.rationale) } };
  }

  async attributeFiles(input: AttributeFilesInput, ctx: AgentContext): Promise<AgentOutcome<FileAttribution[]>> {
    const r = await this.run(
      `把这次改动的文件归属到功能。只读分析，不要修改任何文件。

改动描述：${input.description}
本改动的目标功能：${input.targetFeatureIds.join('、') || '（无）'}
已有功能：
${briefs(input.features)}

已有映射（文件 → 功能 id）：
${Object.entries(input.existing).map(([p, f]) => `${p} → ${f.join(',')}`).join('\n') || '（无）'}

本次改动的文件：
${input.files.join('\n')}

一个文件可以属于多个功能；无法判断时给空数组。只输出一个 JSON 代码块：
\`\`\`json
{"attributions":[{"path":"src/a.ts","featureIds":["f-1"]}]}
\`\`\``,
      'readonly',
      ctx,
    );
    const j = obj(extractJson(r.text));
    const known = new Set(input.features.map((f) => f.featureId));
    const files = new Set(input.files);
    const value = (Array.isArray(j.attributions) ? j.attributions : [])
      .map((a) => obj(a))
      .filter((a) => files.has(str(a.path)))
      .map((a): FileAttribution => ({ path: str(a.path), featureIds: strings(a.featureIds).filter((id) => known.has(id)), source: 'ai' }));
    return { ...r, value };
  }

  async draftExamples(input: DraftExamplesInput, ctx: AgentContext): Promise<AgentOutcome<DraftedExample[]>> {
    const intro =
      input.mode === 'baseline'
        ? `为已有功能「${input.featureName}」起草 2–4 个基线验收例子。它们描述的是**现在已经存在**的行为，检查预期直接通过。`
        : input.mode === 'rewrite'
          ? `下面这条检查在新行为**尚未实现**时就通过了（或根本跑不起来），说明它没有测到新行为。请重写这条检查，使它在实现前失败、实现后通过。
原例子：情况 ${input.rewrite?.given} → 操作 ${input.rewrite?.when} → 期望 ${input.rewrite?.then}
原检查：${input.rewrite?.checkPath}
未实现状态下的运行日志：
${input.rewrite?.log.slice(-3000) ?? ''}`
          : `为新需求起草 3–6 个验收例子和对应检查。检查必须在新行为**尚未实现**时失败（系统会先跑一次"先失败检查"，实现前就通过的检查不能锁定）。`;
    const r = await this.run(
      `${intro}

需求原文：${input.requirement}
功能：${input.featureName}
已有功能：
${briefs(input.features)}

检查用这个命令运行：${input.checkCommand}（{path} 是检查文件路径；检查会被复制到 .stagent/runs/<runId>/checks/ 下执行，
不要用相对路径 import 项目源码，改用 process.env.STAGENT_PROJECT_ROOT；外观例子把截图写到 process.env.STAGENT_SCREENSHOT_PATH）。

**只能**在 ${input.draftDir}/ 下写检查文件，不要改任何其它文件，不要运行命令。
**每个例子一个独立的检查文件**（不同例子不能共用一个文件，否则一个坏了全都算坏，"N 个例子"也会虚高）；每个文件只测这一条例子。
每个例子用"情况 → 操作 → 期望"的格式写给不懂代码的人看（一句话，不要写函数名和规则 id），并附一句大白话摘要"这条检查实际在看什么"。

写完后只输出一个 JSON 代码块：
\`\`\`json
{"examples":[{"given":"…","when":"…","then":"…","kind":"behavior|visual","checkPath":"${input.draftDir}/xxx.spec.ts","summary":"…"}]}
\`\`\``,
      'draft',
      ctx,
    );
    const j = obj(extractJson(r.text));
    const value = (Array.isArray(j.examples) ? j.examples : [])
      .map((e) => obj(e))
      .map(
        (e): DraftedExample => ({
          given: str(e.given),
          when: str(e.when),
          then: str(e.then),
          kind: e.kind === 'visual' ? 'visual' : 'behavior',
          checkPath: str(e.checkPath).replace(/^\.\//, ''),
          summary: str(e.summary),
        }),
      )
      .filter((e) => e.given && e.when && e.then && e.checkPath.startsWith(input.draftDir + '/'));
    if (value.length === 0) throw new AgentRunError('AI 没有给出可用的例子草稿', r.usage, r.sessionId);
    return { ...r, value };
  }

  async implement(input: ImplementInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>> {
    return this.edit(implementPrompt(input), input, ctx);
  }

  async fix(input: FixInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>> {
    const failures = input.failures
      .map((f) => `- [${f.exampleId}]「${f.featureName}」期望：${f.then}（${f.status}）\n日志末尾：\n${f.log.slice(-2000)}`)
      .join('\n\n');
    return this.edit(
      `${implementPrompt(input)}

这是第 ${input.round} 轮修复。上一轮之后系统运行检查，以下例子没有通过：
${failures || '（无详细日志）'}

可能相关的改动文件（被破坏功能的文件 ∩ 本改动的 diff）：
${input.possiblyRelatedFiles.join('\n') || '（无）'}

只能修改被测代码。如果你认为检查本身写错了，不要改它，在回报的「取舍」里说明，由用户授权修改锁定例子。`,
      input,
      ctx,
    );
  }

  async answerDecisionQuestion(input: DecisionQuestionInput, ctx: AgentContext): Promise<AgentOutcome<string>> {
    const r = await this.run(
      `用户在一张决策卡上有疑问，请用大白话简短回答（不超过 200 字）。只读，不要修改任何文件。

决策卡问题：${input.card.question}
背景：${input.card.background}
选项：
${input.card.options.map((o) => `- ${o.label}${o.pros ? `（好处：${o.pros}）` : ''}${o.cons ? `（代价：${o.cons}）` : ''}`).join('\n')}

用户的疑问：${input.question}`,
      'readonly',
      ctx,
    );
    return { ...r, value: r.text.trim() };
  }

  async scanFeatures(
    input: { stackHint: string },
    ctx: AgentContext & { onFeature?: (f: ScannedFeature) => void },
  ): Promise<AgentOutcome<ScannedFeature[]>> {
    const found: ScannedFeature[] = [];
    let buffer = '';
    const onText = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const f = parseFeatureLine(line);
        if (f && !found.some((x) => x.name === f.name)) {
          found.push(f);
          ctx.onFeature?.(f);
        }
      }
    };
    const r = await this.run(
      `只读扫描这个项目（技术栈：${input.stackHint}）的路由、页面和接口，识别用户可见的功能。不要修改任何文件。

每识别出一个功能，立即单独输出一行（不要放进代码块）：
FEATURE {"name":"功能名（大白话）","description":"一句话说明","entryFiles":["相对路径，路由/页面/接口入口文件"]}

全部识别完后输出一行 DONE。`,
      'readonly',
      ctx,
      onText,
    );
    onText('\n');
    for (const line of r.text.split('\n')) {
      const f = parseFeatureLine(line);
      if (f && !found.some((x) => x.name === f.name)) {
        found.push(f);
        ctx.onFeature?.(f);
      }
    }
    return { ...r, value: found };
  }

  async draftRecords(input: DraftRecordsInput, ctx: AgentContext): Promise<AgentOutcome<DraftedRecord[]>> {
    const r = await this.run(
      `一个改动刚刚合并。根据下面的素材起草 0–2 条值得记住的记录（decision 决策 或 pitfall 踩坑）。只读，不要修改任何文件。
标签从这些里选：联调、接口、数据、部署、环境、测试、依赖、界面、性能、安全。没有值得记的就返回空数组。

改动：${input.change.description}（${input.change.track === 'feature' ? '新功能档' : '小改动档'}）
AI 回报：
${input.claims.join('\n---\n') || '（无）'}
失败日志摘要：
${input.failures.join('\n') || '（无）'}
授权原因：
${input.authReasons.join('\n') || '（无）'}

只输出一个 JSON 代码块：
\`\`\`json
{"records":[{"kind":"pitfall","title":"…","body":"…","tags":["环境"]}]}
\`\`\``,
      'readonly',
      ctx,
    );
    const j = obj(extractJson(r.text));
    const value = (Array.isArray(j.records) ? j.records : [])
      .map((x) => obj(x))
      .map((x): DraftedRecord => ({ kind: (x.kind === 'decision' ? 'decision' : 'pitfall') as RecordKind, title: str(x.title), body: str(x.body), tags: strings(x.tags) }))
      .filter((x) => x.title)
      .slice(0, 2);
    return { ...r, value };
  }

  async draftRule(input: DraftRuleInput, ctx: AgentContext): Promise<AgentOutcome<DraftedRule>> {
    const r = await this.run(
      `同一类坑（标签「${input.tag}」）已经踩了 ${input.pitfalls.length} 次。起草一条项目规则，写进 CLAUDE.md 给 AI 遵守。只读，不要修改任何文件。

踩坑记录：
${input.pitfalls.map((p) => `- ${p.title}：${p.body}`).join('\n')}

规则要具体、可执行；同时写清适用条件和失效条件（什么情况下这条规则不再需要）。只输出一个 JSON 代码块：
\`\`\`json
{"text":"…","appliesWhen":"…","expiresWhen":"…"}
\`\`\``,
      'readonly',
      ctx,
    );
    const j = obj(extractJson(r.text));
    if (!str(j.text)) throw new AgentRunError('AI 没有给出规则', r.usage, r.sessionId);
    return { ...r, value: { text: str(j.text), appliesWhen: str(j.appliesWhen), expiresWhen: str(j.expiresWhen) } };
  }

  // ---- 内部 ----

  private async edit(prompt: string, input: ImplementInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>> {
    const r = await this.run(prompt, 'edit', ctx);
    return { ...r, value: parseClaimReport(r.text, input.examples.map((x) => x.exampleId)) };
  }

  private async run(prompt: string, mode: Mode, ctx: AgentContext, onText?: (chunk: string) => void): Promise<QueryResult> {
    const queryFn = this.options.queryFn ?? ((await import('@anthropic-ai/claude-agent-sdk')).query as unknown as QueryFn);
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (ctx.signal?.aborted) abortController.abort();
    else ctx.signal?.addEventListener('abort', onAbort, { once: true });

    const options: Record<string, unknown> = {
      cwd: ctx.projectRoot,
      settingSources: ['project'],
      abortController,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(ctx.resume ? { resume: ctx.resume } : {}),
      ...(ctx.maxBudgetUsd !== undefined ? { maxBudgetUsd: ctx.maxBudgetUsd } : {}),
      ...(mode === 'readonly'
        ? { permissionMode: 'dontAsk', allowedTools: READ_ONLY_TOOLS }
        : mode === 'draft'
          ? { permissionMode: 'acceptEdits', allowedTools: [...READ_ONLY_TOOLS, 'Write', 'Edit'], disallowedTools: ['Bash'] }
          : { permissionMode: 'acceptEdits', allowedTools: [...READ_ONLY_TOOLS, 'Write', 'Edit', 'MultiEdit', 'Bash'] }),
    };

    let sessionId: string | null = null;
    let text = '';
    let result: Record<string, unknown> | null = null;
    try {
      for await (const m of queryFn({ prompt, options })) {
        if (!sessionId && typeof m.session_id === 'string') {
          sessionId = m.session_id;
          ctx.onSession?.(sessionId);
        }
        if (m.type === 'assistant') {
          const content = (obj(m.message).content ?? []) as Record<string, unknown>[];
          for (const block of Array.isArray(content) ? content : []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              text += block.text + '\n';
              onText?.(block.text + '\n');
              const first = block.text.trim().split('\n')[0] ?? '';
              if (first) ctx.onProgress?.({ line: first.slice(0, 120), log: block.text });
            } else if (block.type === 'tool_use') {
              const input = obj(block.input);
              const target = str(input.file_path) || str(input.path) || str(input.pattern) || str(input.command).slice(0, 80);
              ctx.onProgress?.({ line: `${str(block.name)} ${target}`.trim(), log: `→ ${str(block.name)} ${target}` });
            }
          }
        } else if (m.type === 'result') {
          result = m;
        }
      }
    } catch (err) {
      throw new AgentRunError(`Claude Code 运行失败：${(err as Error).message}`, usageOf(result), sessionId);
    } finally {
      ctx.signal?.removeEventListener('abort', onAbort);
    }
    if (!result) throw new AgentRunError(ctx.signal?.aborted ? '已取消' : 'Claude Code 没有返回结果', null, sessionId);
    const usage = usageOf(result);
    if (result.subtype !== 'success') {
      const errors = Array.isArray(result.errors) ? (result.errors as unknown[]).map(String).join('；') : '';
      throw new AgentRunError(
        result.subtype === 'error_max_budget_usd' ? '达到费用上限' : `Claude Code 运行出错（${String(result.subtype)}）${errors ? `：${errors}` : ''}`,
        usage,
        sessionId,
        result.subtype === 'error_max_budget_usd',
      );
    }
    const final = typeof result.result === 'string' ? result.result : '';
    return { text: final || text, usage, sessionId };
  }
}

function implementPrompt(input: ImplementInput): string {
  return `你在 Stagent 管理的项目里实现一个改动。

改动描述：${input.description}

已锁定的验收例子（检查文件只读，系统会亲自运行它们来验证，你的回报不算证据）：
${input.examples.map((x) => `- [${x.exampleId}]「${x.featureName}」情况：${x.given} → 操作：${x.when} → 期望：${x.then}（检查 ${x.checkPath}）`).join('\n') || '（本改动没有新例子，系统会跑全量回归）'}

项目规则：
${input.rules.map((r) => `- ${r}`).join('\n') || '（无）'}

目标功能的已知文件（从哪里入手的提示，不限制改动范围）：
${input.knownFiles.join('\n') || '（无）'}

不要修改 .stagent/ 下的任何文件和测试检查；不要执行危险命令（rm -rf、git reset --hard、强推等）；不要 git commit，合并由用户授权后系统完成。

${REPORT_FORMAT}`;
}

function briefs(features: FeatureBrief[]): string {
  return (
    features
      .map((f) => `- ${f.featureId} · ${f.name} · ${f.stateLabel}${f.files.length ? ` · ${f.files.slice(0, 5).join(', ')}` : ''}`)
      .join('\n') || '（暂无功能）'
  );
}

function parseFeatureLine(line: string): ScannedFeature | null {
  const m = /^\s*FEATURE\s+(\{.*\})\s*$/.exec(line);
  if (!m) return null;
  try {
    const o = obj(JSON.parse(m[1]!));
    const name = str(o.name);
    return name ? { name, description: str(o.description), entryFiles: strings(o.entryFiles) } : null;
  } catch {
    return null;
  }
}

function usageOf(result: Record<string, unknown> | null): AgentUsage | null {
  if (!result) return null;
  const usage = obj(result.usage);
  const models = Object.keys(obj(result.modelUsage));
  return {
    provider: 'anthropic',
    model: models[0] ?? 'unknown',
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    estimatedCost: num(result.total_cost_usd),
  };
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
}
