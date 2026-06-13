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
} from '../workflow/StageToolKinds';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { DELIVERY_WRAPUP_STAGE_ID } from './deliveryWrapupStage';

/** B-Q1 有界 smoke 阶段固定 id。 */
export const SMOKE_RUN_STAGE_ID = 'stage_smoke_run';

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
    const out = (s.toolConfig as LlmTextConfig).writeOutputToFile?.trim();
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

/**
 * B-Q1：在交付收口前注入有界 smoke 阶段——用机器上既有工具链「真跑一遍」。
 * - serve=true：起服务/入口 → grace 存活探测 → 收进程树（不卡执行器）。
 * - 仅当能可靠推导启动命令时注入（复用计划已有 serve 命令，或 JS/py 入口）；否则跳过，避免假失败。
 * - 幂等。
 */
export function injectSmokeStage(stages: Stage[]): Stage[] {
  if (stages.some((s) => s.id === SMOKE_RUN_STAGE_ID)) {
    return stages;
  }
  const start = findExistingServeCommand(stages) ?? deriveStartFromEntry(stages);
  if (!start) {
    return stages; // 无法可靠推导启动命令 → 不注入（不制造假失败）
  }

  // 一次性批处理 CLI（main.py）：非 serve，跑完 exit 0=通过（serve 模式会把立即退出误判为崩溃 → 假失败，T4 Run #58）。
  // 长驻服务（server/app/manage.py、npm start、uvicorn 等）：serve 有界探活。
  const cfg: CodeRunnerConfig = start.oneShot
    ? {
        type: STAGE_TOOL_CODE_RUNNER,
        command: start.command,
        captureOutput: true,
        pathBase: start.pathBase ?? 'workspace',
      }
    : {
        type: STAGE_TOOL_CODE_RUNNER,
        command: start.command,
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
    title: 'Smoke：真启动一次（有界）',
    description: start.oneShot
      ? '用机器上既有工具链真跑一遍入口（一次性运行到结束），验证「真的跑得起来」，而非只靠测试绿。'
      : '用机器上既有工具链有界启动一次（起服务/入口 → 确认存活 → 立即收掉），验证「真的跑得起来」，而非只靠测试绿。',
    aiTip: start.oneShot
      ? '一次性运行入口：exit 0 即通过；非零退出（崩溃/异常）即失败，回到对应实现修。'
      : 'serve 有界运行：起得来即通过；启动后立即崩溃/超时即失败，回到对应实现修。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig: cfg,
    dependsOn: [],
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'smokeOutput', format: 'text' }],
    pauseAfter: false,
  };

  // 放在交付收口（DELIVERY.md）之前；无收口阶段时追加到末尾。
  const deliveryIdx = stages.findIndex((s) => s.id === DELIVERY_WRAPUP_STAGE_ID);
  const prev = (deliveryIdx >= 0 ? stages[deliveryIdx - 1] : stages[stages.length - 1])?.id;
  if (prev) {
    stage.dependsOn = [prev];
  }
  if (deliveryIdx >= 0) {
    return [...stages.slice(0, deliveryIdx), stage, ...stages.slice(deliveryIdx)];
  }
  return [...stages, stage];
}
