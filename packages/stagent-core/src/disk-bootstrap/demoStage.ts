import type { Stage } from '../WorkflowDefinition';
import type {
  CodeRunnerConfig,
  FileWriteConfig,
  LlmTextConfig,
} from '../workflow-types/StageTypes';
import {
  isCodeRunnerTool,
  isFileWriteTool,
  isLlmTextTool,
  STAGE_TOOL_CODE_RUNNER,
  STAGE_TOOL_LLM_TEXT,
} from '../workflow/StageToolKinds';
import { isTestWriteStageId } from '../workflow/StageIdPatterns';
import { DELIVERY_WRAPUP_STAGE_ID } from './deliveryWrapupStage';
import { looksLikeServeCommand, SMOKE_RUN_STAGE_ID } from './smokeStage';

export const DEMO_GENERATE_STAGE_ID = 'stage_demo_generate';
export const DEMO_RUN_STAGE_ID = 'stage_demo_run';

export const DEMO_DIR = 'demo';
export const DEMO_ENTRY_REL = 'demo/run_demo.py';
export const DEMO_SUMMARY_REL = 'demo/summary.json';
export const DEMO_SUMMARY_SCHEMA_REL = 'demo/summary.schema.json';
export const QUICKSTART_REL = 'QUICKSTART.md';

export type DemoModality = 'oneShot-text' | 'serve-probe';

export interface DemoModalityPlan {
  modality: DemoModality;
  /** serve-probe 时复用的启动命令。 */
  serveCommand?: string;
}

/** 工作流中写入 config.yaml 的 file-write 阶段 → demo 可附带 --config。 */
export function findWrittenConfigYaml(stages: Stage[]): string | null {
  for (const s of stages) {
    const isConfigWriter = s.id === 'stage_write_config' || s.id.endsWith('_write_config');
    if (!isConfigWriter || !isFileWriteTool(s.tool)) {
      continue;
    }
    const fp = (s.toolConfig as FileWriteConfig).filePath?.trim();
    if (fp && /\.ya?ml$/i.test(fp)) {
      return fp.replace(/\\/g, '/');
    }
  }
  return null;
}

/** 是否存在「非测试」的真实可交付实现（与 injectDeliveryWrapupStage 同口径）。 */
function hasImplDeliverable(stages: Stage[]): boolean {
  return stages.some(
    (s) =>
      isLlmTextTool(s.tool) &&
      !isTestWriteStageId(s.id) &&
      !!(s.toolConfig as LlmTextConfig).writeOutputToFile?.trim(),
  );
}

/** 从计划中推断体验模态：有非 smoke 的 serve 命令 → serve-probe，否则 oneShot-text。 */
export function inferDemoModality(stages: Stage[]): DemoModalityPlan {
  for (const s of stages) {
    if (!isCodeRunnerTool(s.tool) || s.id === SMOKE_RUN_STAGE_ID || s.id === DEMO_RUN_STAGE_ID) {
      continue;
    }
    const cmd = (s.toolConfig as CodeRunnerConfig).command?.trim();
    if (cmd && looksLikeServeCommand(cmd)) {
      return { modality: 'serve-probe', serveCommand: cmd };
    }
  }
  return { modality: 'oneShot-text' };
}

export function buildDemoGenerateSystemPrompt(
  configYaml: string | null,
  plan: DemoModalityPlan = { modality: 'oneShot-text' },
): string {
  const configLine = configYaml
    ? `- 通过 \`--config ${configYaml}\` 接收配置；从中读取数据/参数（数据 CSV 路径以 config 为准）。`
    : '- 若需配置，复用工作区已落盘的 config 文件；不要发明新的配置键。';
  const modalityHint =
    plan.modality === 'serve-probe'
      ? '脚本在已启动服务上探活并发样例请求，写出 summary.json 与 QUICKSTART.md。'
      : '用样本数据**端到端跑通**已交付管线（不要 mock 被测模块；数据用工作区已种子化的 CSV）。\n脚本须可用一条命令一次性运行完毕并自然退出（非长驻服务）；正常结束 exit 0。';
  return [
    `你在为已交付的 MVP 生成一个「可直接上手体验」的 demo 入口脚本，写入 \`${DEMO_ENTRY_REL}\`。`,
    modalityHint,
    '',
    '硬性要求（这些是后续客观 gate 的验收依据，必须满足）：',
    '1. 只 import 本项目已声明的模块与符号（契约 exports），不要臆造不存在的函数/类。',
    configLine,
    `2. 运行结束时写出机读摘要 \`${DEMO_SUMMARY_REL}\`（JSON 对象），至少含键：`,
    '   - `ran`: 布尔，端到端成功跑完则为 true；',
    '   - 业务摘要（如信号条数 / 处理行数 / 样例响应等，键名自拟但需为非空有意义值）。',
    `3. 同时写出 \`${QUICKSTART_REL}\`（Markdown），含「如何运行」命令与「预期输出」说明。`,
    '',
    '不要在脚本里下结论说产物好坏 / 是否盈利——demo 只负责「跑得起来、产出可读结果」。',
  ].join('\n');
}

export function buildDemoRunConfig(
  configYaml: string | null,
  plan: DemoModalityPlan = { modality: 'oneShot-text' },
): CodeRunnerConfig {
  const py = '.venv/bin/python';
  const entry = DEMO_ENTRY_REL;
  const configArg = configYaml ? ` --config ${configYaml}` : '';
  if (plan.modality === 'serve-probe' && plan.serveCommand) {
    return {
      type: STAGE_TOOL_CODE_RUNNER,
      command: plan.serveCommand,
      captureOutput: true,
      pathBase: 'workspace',
      serve: true,
      graceMs: 5_000,
      readyTimeoutMs: 30_000,
      readyProbe: `${py} ${entry}${configArg}`,
    };
  }
  return {
    type: STAGE_TOOL_CODE_RUNNER,
    command: `${py} ${entry}${configArg}`,
    captureOutput: true,
    pathBase: 'workspace',
  };
}

interface InjectDemoOptions {
  /** 调用方按 delivery.demoDelivery 配置决定是否注入；默认 true（调用即注入）。 */
  enabled?: boolean;
}

/**
 * 注入 demo 两阶段（幂等）：
 * - 放在 stage_delivery_wrapup 之前；锚点为 delivery 前一阶段（通常是 smoke 或末位 test_run）。
 * - 仅当存在非测试实现产物时注入（无可体验对象则跳过，避免给纯文档加噪声）。
 * - generate.dependsOn = [anchor]；run.dependsOn = [generate]。
 */
export function injectDemoStages(stages: Stage[], opts: InjectDemoOptions = {}): Stage[] {
  if (opts.enabled === false) {
    return stages;
  }
  if (stages.some((s) => s.id === DEMO_GENERATE_STAGE_ID || s.id === DEMO_RUN_STAGE_ID)) {
    return stages;
  }
  if (!hasImplDeliverable(stages)) {
    return stages;
  }

  const configYaml = findWrittenConfigYaml(stages);
  const plan = inferDemoModality(stages);
  const deliveryIdx = stages.findIndex((s) => s.id === DELIVERY_WRAPUP_STAGE_ID);
  const anchor =
    (deliveryIdx >= 0 ? stages[deliveryIdx - 1] : stages[stages.length - 1])?.id ??
    SMOKE_RUN_STAGE_ID;

  const generateStage: Stage = {
    id: DEMO_GENERATE_STAGE_ID,
    title: 'Demo：生成可体验入口',
    description:
      plan.modality === 'serve-probe'
        ? '生成 demo/run_demo.py：探活已启动的服务并发起样例请求，写出 summary.json 与 QUICKSTART.md。'
        : '生成 demo/run_demo.py：用样本数据端到端跑通交付物，运行时写出 summary.json 与 QUICKSTART.md，供用户直接上手。',
    aiTip: '只调用已声明的契约 exports；用种子数据真跑，不 mock 被测模块。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig: {
      type: STAGE_TOOL_LLM_TEXT,
      systemPrompt: buildDemoGenerateSystemPrompt(configYaml, plan),
      writeOutputToFile: DEMO_ENTRY_REL,
      writePathBase: 'workspace',
    },
    dependsOn: [anchor],
    input: {
      sources: [{ type: 'user-input', label: '原始需求' }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: 'demoEntry', format: 'file-path' }],
    pauseAfter: false,
  };

  const runStage: Stage = {
    id: DEMO_RUN_STAGE_ID,
    title:
      plan.modality === 'serve-probe' ? 'Demo：起服务 + 探针体验' : 'Demo：真跑一遍（一次性）',
    description:
      plan.modality === 'serve-probe'
        ? '启动服务 → 探针脚本请求 → 验收 summary.json / QUICKSTART.md。'
        : '一次性运行 demo/run_demo.py，验收 exit 0 与产物。',
    aiTip: '跑完即判：报错或缺产物 → 回 stage_demo_generate 修；不评判结果好坏。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig: buildDemoRunConfig(configYaml, plan),
    dependsOn: [DEMO_GENERATE_STAGE_ID],
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'demoOutput', format: 'text' }],
    pauseAfter: false,
  };

  if (deliveryIdx >= 0) {
    return [
      ...stages.slice(0, deliveryIdx),
      generateStage,
      runStage,
      ...stages.slice(deliveryIdx),
    ];
  }
  return [...stages, generateStage, runStage];
}
