import type { Stage } from '../WorkflowDefinition';
import type {
  CodeRunnerConfig,
  FileWriteConfig,
  LlmTextConfig,
  ToolPathBase,
} from '../workflow-types/StageTypes';
import {
  isCodeRunnerTool,
  isFileWriteTool,
  isLlmTextTool,
  STAGE_TOOL_CODE_RUNNER,
  STAGE_TOOL_LLM_TEXT,
} from '../workflow/StageToolKinds';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { writeOutputToFileOf } from '../workflow/StageToolConfigAccess';
import { CODE_RUNNER_EXIT_OUTPUT_KEY, VERIFY_OUT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { buildNodeExtensionScriptCommand } from '../contract-infra';
import { DELIVERY_WRAPUP_STAGE_ID } from './deliveryWrapupStage';

/**
 * B-Q1 有界 smoke 阶段固定 id。
 * ADR-0008：采用 `stage_test_run_smoke`（test_run 语义 'smoke'）以复用既有自修复机制——
 * 失败时 `trySelfHealAfterTestRunFailure` 软失败转 fix 链，配对 `stage_fix_if_failed_smoke`
 * 修复主入口后 `afterFixIfFailedStage` 回绕重跑（使「main 跑不起来/产出平凡」可被自动修复）。
 */
export const SMOKE_RUN_STAGE_ID = 'stage_test_run_smoke';

/** smoke 配对修复阶段固定 id（semantic 'smoke' → stage_test_run_smoke，被 FixExhaustedRouter 识别）。 */
export const SMOKE_FIX_STAGE_ID = 'stage_fix_if_failed_smoke';

/** 历史 smoke 阶段 id（LLM 为 serve 应用自编排时仍用此名，见 PromptFragments.SERVE_SMOKE_CONSTRAINT_TEXT）。 */
export const LEGACY_SMOKE_RUN_STAGE_ID = 'stage_smoke_run';

/** 识别 smoke 阶段（含历史 serve id 与新 test_run id），供幂等/验收/体验模态等处统一判定。 */
export function isSmokeStageId(id: string): boolean {
  return id === SMOKE_RUN_STAGE_ID || id === LEGACY_SMOKE_RUN_STAGE_ID;
}

/** 长驻 serve/启动命令特征（用于复用计划中已有的启动命令；test_run=npm test 不命中）。 */
const SERVE_COMMAND_PATTERNS: RegExp[] = [
  /\bnpm\s+(start|run\s+(dev|serve|start))\b/,
  /\b(pnpm|yarn)\s+(start|dev|serve)\b/,
  /\bnpx\s+expo\s+start\b/,
  /\bflutter\s+run\b/,
  /\bnode\s+\S*(index|server|main|app)\S*\.(c|m)?js\b/,
  /\b(uvicorn|gunicorn|nodemon)\b/,
  /\bpython3?\s+\S*(server|app|manage)\S*\.py\b/,
];

export function looksLikeServeCommand(command: string): boolean {
  return SERVE_COMMAND_PATTERNS.some((re) => re.test(command));
}

interface DerivedStart {
  command: string;
  workingDir?: string;
  pathBase?: ToolPathBase;
  /** 一次性批处理入口（如 CLI main.py）：跑完即判，exit 0=通过；非 serve 长驻。 */
  oneShot?: boolean;
}

/** 优先复用计划中已有的「启动/serve」code-runner 命令（最可靠）。 */
function findExistingServeCommand(stages: Stage[]): DerivedStart | null {
  for (const s of stages) {
    if (!isCodeRunnerTool(s.tool) || isTestRunStageId(s.id)) {
      continue;
    }
    const cfg = s.toolConfig as CodeRunnerConfig;
    if (cfg.command && looksLikeServeCommand(cfg.command)) {
      return { command: cfg.command, workingDir: cfg.workingDir, pathBase: cfg.pathBase ?? 'workspace' };
    }
  }
  return null;
}

/** 工作流中写入 config.yaml 的 file-write 阶段 → smoke 可附带 --config。 */
function findWrittenConfigYaml(stages: Stage[]): string | null {
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

/** 退而求其次：从「可直接运行」的入口产物推导（仅 JS / main.py；TS 需构建，不可靠，跳过）。 */
function deriveStartFromEntry(stages: Stage[]): DerivedStart | null {
  const files: string[] = [];
  for (const s of stages) {
    if (!isLlmTextTool(s.tool)) {
      continue;
    }
    const out = writeOutputToFileOf(s);
    if (out) {
      files.push(out.replace(/\\/g, '/'));
    }
  }
  const jsEntry = files.find((f) => /(^|\/)(index|server|main|app)\.(c|m)?js$/.test(f));
  if (jsEntry) {
    return { command: `node ${jsEntry}`, pathBase: 'workspace' };
  }
  const pyEntry = files.find((f) => /(^|\/)(server|app|main|manage)\.py$/.test(f));
  if (pyEntry) {
    // T4 Run #31：裸 `python3 main.py` 因 argparse 缺 --config 立即退出 → smoke 假失败。
    // 若计划含 config 落盘阶段，附带 --config 并用 venv 解释器（与 test_run 一致）。
    const configYaml = findWrittenConfigYaml(stages);
    const py = '.venv/bin/python';
    // T4 Run #58：main.py 多为一次性批处理 CLI（跑完 exit 0），serve 模式会把「立即退出」
    // 判为崩溃 → 假失败；仅 server/app/manage.py 视为长驻服务。
    const oneShot = !/(^|\/)(server|app|manage)\.py$/.test(pyEntry);
    const command = configYaml
      ? `${py} ${pyEntry} --config ${configYaml}`
      : `${py} ${pyEntry}`;
    return { command, pathBase: 'workspace', oneShot };
  }
  return null;
}

/** 本次工作流落盘的「主入口」实现文件（main/cli/app/server 等），供 smoke fix 写回。 */
function findMainEntryImplPath(stages: Stage[]): string | undefined {
  const files: string[] = [];
  for (const s of stages) {
    if (!isLlmTextTool(s.tool)) {
      continue;
    }
    const out = writeOutputToFileOf(s);
    if (out) {
      files.push(out.replace(/\\/g, '/'));
    }
  }
  return (
    files.find((f) => /(^|\/)(main|cli)\.py$/.test(f)) ??
    files.find((f) => /(^|\/)(server|app|manage)\.py$/.test(f)) ??
    files.find((f) => /(^|\/)(index|server|main|app)\.(c|m)?js$/.test(f))
  );
}

/**
 * ADR-0008：smoke 失败后的配对修复阶段（main 入口真跑不起来 / 产出平凡 → 自动修）。
 * id=stage_fix_if_failed_smoke（semantic 'smoke'），由 FixExhaustedRouter / afterFixIfFailedStage
 * 识别并在修复后回绕重跑 smoke。skipIf=exitCodeZero：smoke 通过则跳过。
 */
function buildSmokeFixStage(opts: {
  dependsOn: string[];
  mainEntry: string;
  isPython: boolean;
}): Stage {
  const { dependsOn, mainEntry, isPython } = opts;
  const langHint = isPython
    ? '（Python）：确保 `if __name__ == "__main__": main()` 真正调用主逻辑；写出产出前用 `os.makedirs(dir, exist_ok=True)` 创建输出目录；不要用宽 `except Exception` 吞掉致命错误（让其非零退出并暴露）。'
    : '（Node/JS）：确保入口真正执行主逻辑并写出产出文件；写出前确保输出目录存在；不要静默吞掉致命错误。';
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      '真实集成冒烟阶段 stage_test_run_smoke 失败后执行修复（ADR-0008 真实集成冒烟门）。',
      'smoke 做的事：用真实依赖跑一遍主入口，并断言任务声明的 JSON 产出存在且非平凡（非全零/空值）。',
      '失败含义之一：',
      '  - 主入口 exit 非零（崩溃/异常）；或',
      '  - exit 0 但产出缺失/为空（main() 从未被调用、未创建输出目录、错误被吞）；或',
      '  - 产出全为零/空值（数据未导入或管道未生效的「空心绿」）。',
      `修复要点${langHint}`,
      `主修改文件：${mainEntry}。若根因在数据管道/装配，可一并修正相关实现文件。`,
      '禁止为「过断言」而硬编码假产出；产出必须由真实业务逻辑写出。',
      '只输出需写入文件的完整正文到 writeOutputToFile 指定路径；禁止 Markdown 围栏。',
    ].join('\n'),
    writeOutputToFile: mainEntry,
    writePathBase: 'workspace',
  };
  return {
    id: SMOKE_FIX_STAGE_ID,
    title: '修复冒烟失败（主入口真跑不起来 / 产出平凡）',
    description: 'smoke 失败后：修复主入口装配与产出写出，使真实运行产出非平凡，供回绕重跑。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn,
    input: {
      sources: [
        {
          type: 'stage-output',
          stageId: SMOKE_RUN_STAGE_ID,
          outputKey: VERIFY_OUT_OUTPUT_KEY,
          label: 'smoke 输出',
        },
      ],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: 'fixPatch', format: 'text' }],
    pauseAfter: false,
  };
}

/**
 * B-Q1 / ADR-0008：在交付收口前注入有界 smoke 阶段——用机器上既有工具链「真跑一遍」。
 * - serve=true：起服务/入口 → grace 存活探测 → 收进程树（不卡执行器）。
 * - oneShot 批处理入口（main.py/cli）：跑完即判 + **断言声明产出非平凡**（真实集成冒烟），
 *   并注入配对 fix 阶段，失败走既有 fix 链自动修复（不再只是事后判红无回路）。
 * - 仅当能可靠推导启动命令时注入（复用计划已有 serve 命令，或 JS/py 入口）；否则跳过，避免假失败。
 * - 幂等。
 */
export function injectSmokeStage(stages: Stage[]): Stage[] {
  if (stages.some((s) => isSmokeStageId(s.id))) {
    return stages;
  }
  const start = findExistingServeCommand(stages) ?? deriveStartFromEntry(stages);
  if (!start) {
    return stages; // 无法可靠推导启动命令 → 不注入（不制造假失败）
  }

  // oneShot 批处理 CLI：主入口跑完后追加产出断言（ADR-0008：跑主路径 + 断言产出非平凡）。
  // 缺产出 / 产出全零 → node 脚本非零退出 → smoke 失败 → 走 fix 链修主入口。
  const verifyOutputCmd = buildNodeExtensionScriptCommand('verify-smoke-output.mjs', []);
  const smokeCommand = start.oneShot ? `${start.command} && ${verifyOutputCmd}` : start.command;

  // 一次性批处理 CLI（main.py）：非 serve，跑完 exit 0=通过（serve 模式会把立即退出误判为崩溃 → 假失败，T4 Run #58）。
  // 长驻服务（server/app/manage.py、npm start、uvicorn 等）：serve 有界探活。
  const cfg: CodeRunnerConfig = start.oneShot
    ? {
        type: STAGE_TOOL_CODE_RUNNER,
        command: smokeCommand,
        captureOutput: true,
        pathBase: start.pathBase ?? 'workspace',
      }
    : {
        type: STAGE_TOOL_CODE_RUNNER,
        command: smokeCommand,
        captureOutput: true,
        pathBase: start.pathBase ?? 'workspace',
        serve: true,
        graceMs: 5_000,
        readyTimeoutMs: 30_000,
      };
  if (start.workingDir) {
    cfg.workingDir = start.workingDir;
  }

  const stage: Stage = {
    id: SMOKE_RUN_STAGE_ID,
    title: 'Smoke：真启动一次（有界）+ 断言产出',
    description: start.oneShot
      ? '用机器上既有工具链真跑一遍入口（一次性运行到结束）并断言声明产出非平凡，验证「真的可交付」，而非只靠测试绿。'
      : '用机器上既有工具链有界启动一次（起服务/入口 → 确认存活 → 立即收掉），验证「真的跑得起来」，而非只靠测试绿。',
    aiTip: start.oneShot
      ? '一次性运行入口 + 产出断言：exit 0 且产出非平凡即通过；崩溃/无产出/产出全零即失败，回到 fix 阶段修主入口。'
      : 'serve 有界运行：起得来即通过；启动后立即崩溃/超时即失败，回到对应实现修。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig: cfg,
    dependsOn: [],
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: VERIFY_OUT_OUTPUT_KEY, format: 'text' }],
    pauseAfter: false,
  };

  // 放在交付收口（DELIVERY.md）之前；无收口阶段时追加到末尾。
  const deliveryIdx = stages.findIndex((s) => s.id === DELIVERY_WRAPUP_STAGE_ID);
  const prev = (deliveryIdx >= 0 ? stages[deliveryIdx - 1] : stages[stages.length - 1])?.id;
  if (prev) {
    stage.dependsOn = [prev];
  }

  // oneShot 才配对 fix 阶段（serve 模式无产出断言，沿用既有 exit-0 语义、不接 fix 链）。
  const mainEntry = start.oneShot ? findMainEntryImplPath(stages) : undefined;
  const toInsert: Stage[] = [stage];
  if (start.oneShot && mainEntry) {
    toInsert.push({
      ...buildSmokeFixStage({
        dependsOn: [SMOKE_RUN_STAGE_ID],
        mainEntry,
        isPython: /\.py$/.test(mainEntry),
      }),
      skipIf: {
        type: 'exitCodeZero',
        stageId: SMOKE_RUN_STAGE_ID,
        outputKey: CODE_RUNNER_EXIT_OUTPUT_KEY,
      },
    });
  }

  if (deliveryIdx >= 0) {
    return [...stages.slice(0, deliveryIdx), ...toInsert, ...stages.slice(deliveryIdx)];
  }
  return [...stages, ...toInsert];
}
