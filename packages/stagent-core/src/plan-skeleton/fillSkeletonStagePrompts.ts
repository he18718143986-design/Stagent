import type { Stage } from '../WorkflowDefinition';
import type { WebviewPanel } from '../platform/HostTypes';
import { extractJsonObject } from '../JsonExtract';
import { normalizeModuleExports } from '../commitment/decisionArtifactsSchema';
import { GENERATION_OPERATION_WORKFLOW } from '../generation/GenerationOperationIds';
import { TRACE_STAGE_WORKFLOW_GEN } from '../generation/GenerationTraceStageIds';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readMaxWorkflowParseRetries } from '../settings/readers/exec';
import type { GenerationRunnerHost } from '../WorkflowGenerationRunner';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { GLOBAL_CONFIG_DECIDE_STAGE_ID } from './constants';

export interface SkeletonSemanticFillResult {
  stagePrompts: Record<string, string>;
  globalModules?: Array<{ name: string; exports: string[] }>;
}

const FILL_SYSTEM_PROMPT = `你是 Stagent 工作计划语义填充器。根据用户需求与模块切片，为每个 llm-text 阶段生成完整 systemPrompt（领域语义段落）。

输出**唯一**一个 JSON 对象（不要用 markdown 围栏）：
{"stagePrompts":{"<stage_id>":"..."},"globalModules":[{"name":"<模块名>","exports":["符号1"]}]}

规则：
- stagePrompts 的 key 必须与输入 stages[].id 完全一致；值为完整 systemPrompt 正文（勿含「骨架模板 · 待语义填充」前缀）。
- 全局 decide（stage_decide_architecture_overview）：覆盖全部 modules[] 的接口边界与南华期货/量化交易领域约束；须提示产出 decisionArtifacts sidecar（configContent + modules[]）。
- 切片 decide（stage_decide_<语义>）：单模块边界与 decisionArtifacts.modules 单条契约。
- test_write（stage_test_write_<语义>）：RED pytest；仅 import 契约 exports 中已声明符号；禁止发明符号；import 示例必须为 from <模块名> import（模块名=切片语义），禁止 your_module 占位符。
- impl（stage_impl_<语义>）：GREEN 实现；遵循 DecisionRecord；仅实现契约 exports；只提及该阶段 writeOutputToFile 对应的**单一**落盘路径，禁止「path A 或 path B」或多文件落盘暗示。
- globalModules 可选；列出全部切片模块名与建议 exports（供全局 decide 参考）。
- 勿输出与契约后缀冲突的额外 import 规则（引擎会追加 SLICE_MODULE_CONTRACT_SUFFIX / TEST_WRITE 接线）。`;

function buildUserPayload(input: {
  userInput: string;
  modules: string[];
  stages: Stage[];
}): string {
  const stageRows = input.stages
    .filter((s) => isLlmTextTool(s.tool))
    .map((s) => {
      const prompt =
        s.toolConfig.type === 'llm-text' ? (s.toolConfig.systemPrompt ?? '').slice(0, 200) : '';
      return { id: s.id, title: s.title, placeholder: prompt };
    });
  return JSON.stringify(
    {
      userInput: input.userInput,
      modules: input.modules,
      stages: stageRows,
      globalDecideStageId: GLOBAL_CONFIG_DECIDE_STAGE_ID,
    },
    null,
    2,
  );
}

function parseFillResponse(raw: string): SkeletonSemanticFillResult | null {
  const candidate = extractJsonObject(raw.trim());
  if (!candidate) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const o = parsed as { stagePrompts?: unknown; globalModules?: unknown };
  if (!o.stagePrompts || typeof o.stagePrompts !== 'object') {
    return null;
  }
  const stagePrompts: Record<string, string> = {};
  for (const [id, val] of Object.entries(o.stagePrompts as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) {
      stagePrompts[id] = val.trim();
    }
  }
  if (Object.keys(stagePrompts).length === 0) {
    return null;
  }
  let globalModules: Array<{ name: string; exports: string[] }> | undefined;
  if (Array.isArray(o.globalModules)) {
    const normalized = normalizeModuleExports(
      o.globalModules as Array<{ name: string; exports: string[] }>,
    );
    if (normalized.length > 0) {
      globalModules = normalized;
    }
  }
  return { stagePrompts, globalModules };
}

/**
 * 一次 LLM 调用生成 stagePrompts 映射（PRD §8.4 语义填充 / R1）。
 * 解析失败：重试 ≤ generation.maxParseRetries；仍失败则 warn 并返回 null（保留占位 prompt）。
 */
export async function fillSkeletonStagePrompts(
  host: GenerationRunnerHost,
  panel: WebviewPanel,
  input: {
    userInput: string;
    modules: string[];
    stages: Stage[];
  },
): Promise<SkeletonSemanticFillResult | null> {
  const maxAttempts = readMaxWorkflowParseRetries(getStagentConfiguration());
  const userPayload = buildUserPayload(input);

  host.postGenerationProgress(
    panel,
    GENERATION_OPERATION_WORKFLOW,
    'llm',
    '骨架语义填充',
    '一次 LLM 调用生成各阶段 systemPrompt…',
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await host.invokeLlmRaw(
      FILL_SYSTEM_PROMPT,
      userPayload,
      panel,
      TRACE_STAGE_WORKFLOW_GEN,
      { jsonMode: true },
    );
    const parsed = parseFillResponse(raw);
    if (parsed) {
      return parsed;
    }
    if (attempt < maxAttempts) {
      host.postGenerationProgress(
        panel,
        GENERATION_OPERATION_WORKFLOW,
        'parsing',
        '骨架语义填充',
        `JSON 解析失败，重试（${attempt + 1}/${maxAttempts}）…`,
      );
    }
  }

  host.warn('骨架语义填充失败：保留占位 systemPrompt（headless strict 可升为 hard）');
  return null;
}
