/**
 * 桩执行器：按脚本返回结果、按脚本改文件，不调用任何模型。供测试与演示使用（CI 不依赖真实调用）。
 *
 * 每个方法都可以用 handlers 覆盖；默认行为保守（不改代码、给出最小可用结果）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileAttribution } from '../ledger/types.js';
import { parseClaimReport } from './report.js';
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
  FixInput,
  ImplementInput,
  ScannedFeature,
} from './types.js';

type Handler<I, O, C = AgentContext> = (input: I, ctx: C) => O | Promise<O>;

export interface ScriptedHandlers {
  classifyChange?: Handler<ClassifyInput, Classification>;
  draftPlan?: Handler<DraftPlanInput, DraftedPlan>;
  attributeFiles?: Handler<AttributeFilesInput, FileAttribution[]>;
  draftExamples?: Handler<DraftExamplesInput, DraftedExample[]>;
  implement?: Handler<ImplementInput, string>;
  fix?: Handler<FixInput, string>;
  answerDecisionQuestion?: Handler<DecisionQuestionInput, string>;
  scanFeatures?: Handler<{ stackHint: string }, ScannedFeature[], AgentContext & { onFeature?: (f: ScannedFeature) => void }>;
  draftRecords?: Handler<DraftRecordsInput, DraftedRecord[]>;
  draftRule?: Handler<DraftRuleInput, DraftedRule>;
}

export interface ScriptedOptions {
  available?: boolean;
  /** 每次调用记的费用（美元）。 */
  costPerCall?: number;
}

export class ScriptedExecutor implements AgentExecutor {
  readonly name = 'scripted';
  readonly calls: { method: string; input: unknown }[] = [];

  constructor(
    public handlers: ScriptedHandlers = {},
    private readonly options: ScriptedOptions = {},
  ) {}

  async availability(): Promise<AgentAvailability> {
    return this.options.available === false ? { available: false, reason: 'Claude Code 未登录', hint: 'claude /login' } : { available: true };
  }

  classifyChange(input: ClassifyInput, ctx: AgentContext) {
    return this.call('classifyChange', input, ctx, this.handlers.classifyChange ?? (() => ({ track: 'small' as const, targetFeatureIds: [] as string[], suggestPlan: false, rationale: '桩：默认小改动' as string })));
  }

  draftPlan(input: DraftPlanInput, ctx: AgentContext) {
    return this.call('draftPlan', input, ctx, this.handlers.draftPlan ?? (() => ({ rationale: '桩', steps: [{ stepId: 's1', title: input.requirement, intent: input.requirement, track: 'feature' as const }] })));
  }

  attributeFiles(input: AttributeFilesInput, ctx: AgentContext) {
    return this.call(
      'attributeFiles',
      input,
      ctx,
      this.handlers.attributeFiles ??
        (() => input.files.map((path): FileAttribution => ({ path, featureIds: input.existing[path] ?? input.targetFeatureIds, source: 'ai' }))),
    );
  }

  draftExamples(input: DraftExamplesInput, ctx: AgentContext) {
    return this.call('draftExamples', input, ctx, this.handlers.draftExamples ?? (() => []));
  }

  implement(input: ImplementInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>> {
    return this.call('implement', input, ctx, async (i, c) =>
      parseClaimReport(await (this.handlers.implement ?? defaultReport)(i, c), i.examples.map((x) => x.exampleId)),
    );
  }

  fix(input: FixInput, ctx: AgentContext): Promise<AgentOutcome<ClaimReport>> {
    return this.call('fix', input, ctx, async (i, c) =>
      parseClaimReport(await (this.handlers.fix ?? defaultReport)(i, c), i.examples.map((x) => x.exampleId)),
    );
  }

  answerDecisionQuestion(input: DecisionQuestionInput, ctx: AgentContext) {
    return this.call('answerDecisionQuestion', input, ctx, this.handlers.answerDecisionQuestion ?? (() => `桩回答：${input.question}`));
  }

  scanFeatures(input: { stackHint: string }, ctx: AgentContext & { onFeature?: (f: ScannedFeature) => void }) {
    return this.call('scanFeatures', input, ctx, async (i, c) => {
      const list = await (this.handlers.scanFeatures ?? (() => []))(i, c);
      for (const f of list) c.onFeature?.(f);
      return list;
    });
  }

  draftRecords(input: DraftRecordsInput, ctx: AgentContext) {
    return this.call('draftRecords', input, ctx, this.handlers.draftRecords ?? (() => []));
  }

  draftRule(input: DraftRuleInput, ctx: AgentContext) {
    return this.call(
      'draftRule',
      input,
      ctx,
      this.handlers.draftRule ?? (() => ({ text: `注意「${input.tag}」类问题`, appliesWhen: `涉及${input.tag}时`, expiresWhen: '连续 10 次改动没有再出现' })),
    );
  }

  private async call<I, O, C extends AgentContext>(method: string, input: I, ctx: C, fn: Handler<I, O, C>): Promise<AgentOutcome<O>> {
    this.calls.push({ method, input });
    const sessionId = `scripted-${method}-${this.calls.length}`;
    ctx.onSession?.(sessionId);
    ctx.onProgress?.({ line: `桩执行器：${method}` });
    const value = await fn(input, ctx);
    const usage: AgentUsage = { provider: 'scripted', model: 'scripted', inputTokens: 0, outputTokens: 0, estimatedCost: this.options.costPerCall ?? 0 };
    return { value, usage, sessionId };
  }
}

function defaultReport(): string {
  return '## 改了什么\n（桩执行器没有修改任何文件）\n\n## 取舍\n无\n\n## 例子\n无\n';
}

/** 测试辅助：写文件（相对项目根目录）。 */
export async function writeProjectFile(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
