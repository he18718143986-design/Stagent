/**
 * code-runner 命令的反模式 lint（B-2）。
 *
 * 在两处共享调用：
 * 1. 生成期：`validateGeneratedWorkflow` — 命中为 HARD GATE 错误（拒推 workflowGenerated）。
 * 2. 运行期：`WorkflowExecutor.executeNonLlmTool` 在 spawn 之前 — 命中抛 `invariant-violation:`，
 *    便于已持久化旧工作流在恢复/重试时立刻得到可操作建议。
 *
 * 规则集（code 便于脚本 / analyze-failures 聚合）：
 *   T1 `tsc-noemit-vs-out-dependency` — tsc … --noEmit 与同条 command 内的 require/node ./out/… 并存
 *   T2 `tsc-without-npx` — 出现裸 `tsc` 调用（非 npx / pnpm exec / yarn dlx / .bin/ 链式启动）
 *   T3 `bare-tsc-without-project` — 出现 `tsc` 但未带 `-p` / `--project` / `-b`（工程编译）
 *   T4 `missing-npm-install-before-tsc` — command 含 `tsc`，且同条 command 内无 install/ci，且线性顺序上此前无 npm install/ci 类 code-runner
 *   T5 `import-meta-url-with-commonjs` — workspace 存在 tsconfig.json 且 module 为 CommonJS 系，而 src/ 下源码含 import.meta（与 Node emit 不兼容）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CodeRunnerConfig, WorkflowDefinition } from './WorkflowDefinition';
import { collectWorkflowArtifacts } from './WorkflowArtifactRegistry';
import { detectPythonImportLintIssues } from './CodeRunnerImportLint';
import { isCodeRunnerTool } from './workflow/StageToolKinds';
import { readDangerousCommandLintMode } from './settings/SettingsReaders';

export interface CodeRunnerCommandIssue {
  code: string;
  message: string;
}

function hasTscNoEmit(cmd: string): boolean {
  return /\btsc\b[^|&;\n]*--noEmit\b/.test(cmd);
}

function hasOutDependency(cmd: string): boolean {
  const requireOut = /require\s*\(\s*\\?['"`]\.{0,2}\/?out\//.test(cmd);
  const nodeOut = /\bnode\b\s+(?:--?\S+\s+)*\\?['"`]?\.{0,2}\/?out\//.test(cmd);
  return requireOut || nodeOut;
}

/** 任一 `tsc` 词元前是否由 npx / pnpm exec / yarn dlx 或 node_modules/.bin/ 启动 */
function everyTscAcceptablyLaunched(cmd: string): boolean {
  const re = /\btsc\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    const before = cmd.slice(0, m.index).trimEnd();
    if (!before) {
      return false;
    }
    const ok =
      /\bnpx\s*$/i.test(before) ||
      /\bpnpm\s+exec\s*$/i.test(before) ||
      /\byarn\s+dlx\s*$/i.test(before) ||
      /[/\\]\.bin[/\\]\s*$/i.test(before);
    if (!ok) {
      return false;
    }
  }
  return true;
}

function hasTscToken(cmd: string): boolean {
  return /\btsc\b/.test(cmd);
}

function hasProjectStyleFlag(cmd: string): boolean {
  return /(^|[\s;&|])(-p|--project|-b)(=|\s|$)/.test(cmd);
}

function commandSelfHasDependencyInstall(cmd: string): boolean {
  return (
    /\bnpm\s+ci\b/.test(cmd) ||
    /\bnpm\s+install\b/.test(cmd) ||
    /\bpnpm\s+install\b/.test(cmd) ||
    /\bpnpm\s+i\b/.test(cmd) ||
    /\byarn\s+install\b/.test(cmd)
  );
}

function priorLinearStagesHadNpmInstall(stages: WorkflowDefinition['stages'], beforeIndex: number): boolean {
  const list = stages ?? [];
  for (let i = 0; i < beforeIndex; i += 1) {
    const s = list[i];
    if (s.tool !== 'code-runner') {
      continue;
    }
    const cmd = (s.toolConfig as Partial<CodeRunnerConfig>).command;
    if (typeof cmd === 'string' && commandSelfHasDependencyInstall(cmd)) {
      return true;
    }
  }
  return false;
}

function tryParseTsconfigModule(tsconfigPath: string): string | undefined {
  try {
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLine = noBlock.replace(/^\s*\/\/.*$/gm, '');
    const j = JSON.parse(noLine) as { compilerOptions?: { module?: string } };
    return j.compilerOptions?.module;
  } catch {
    return undefined;
  }
}

function isCommonJsLikeModule(mod: string | undefined): boolean {
  if (!mod) {
    return true;
  }
  const m = mod.toLowerCase();
  return m === 'commonjs' || m === 'none' || m === 'umd' || m === 'amd' || m === 'system';
}

function workspaceSrcUsesImportMeta(workspaceRoot: string): boolean {
  const srcDir = path.join(workspaceRoot, 'src');
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    return false;
  }
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 5) {
      return false;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) {
        continue;
      }
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (walk(p, depth + 1)) {
          return true;
        }
      } else if (/\.(ts|mts|cts)$/.test(ent.name)) {
        try {
          const c = fs.readFileSync(p, 'utf-8');
          if (/\bimport\s*\.meta\b/.test(c)) {
            return true;
          }
        } catch {
          /* skip */
        }
      }
    }
    return false;
  };
  return walk(srcDir, 0);
}

export function detectImportMetaUrlVsCommonJsWorkspace(workspaceRoot: string | undefined): CodeRunnerCommandIssue[] {
  if (!workspaceRoot?.trim()) {
    return [];
  }
  const root = workspaceRoot.trim();
  if (!fs.existsSync(root)) {
    return [];
  }
  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return [];
  }
  const mod = tryParseTsconfigModule(tsconfigPath);
  if (!isCommonJsLikeModule(mod)) {
    return [];
  }
  if (!workspaceSrcUsesImportMeta(root)) {
    return [];
  }
  return [
    {
      code: 'import-meta-url-with-commonjs',
      message: `tsconfig compilerOptions.module 为 CommonJS 系（当前解析为 ${JSON.stringify(
        mod ?? '(缺省/解析失败按 commonjs 处理)',
      )}），但 workspace/src 下存在使用 import.meta 的源码；请改为 ESModule（如 "module":"NodeNext" + package.json "type":"module"）或移除 import.meta。`,
    },
  ];
}

export function detectCodeRunnerCommandIssues(command: string): CodeRunnerCommandIssue[] {
  const issues: CodeRunnerCommandIssue[] = [];
  if (typeof command !== 'string' || command.length === 0) {
    return issues;
  }
  if (hasTscNoEmit(command) && hasOutDependency(command)) {
    issues.push({
      code: 'tsc-noemit-vs-out-dependency',
      message:
        'command 同时含 `tsc --noEmit` 与 `require/node ./out/...`；--noEmit 不产出 .js，必然报 Cannot find module \'./out/...\'。任选一种修复：(a) 去掉 --noEmit 让 tsc 真正产出（`npx tsc -p tsconfig.json && node ./out/...`）；(b) 改用 `npx ts-node src/...` 直接跑 .ts 源码；(c) 固化为 `npm test`，让 package.json scripts 串接编译与执行。',
    });
  }
  if (hasTscToken(command) && !everyTscAcceptablyLaunched(command)) {
    issues.push({
      code: 'tsc-without-npx',
      message:
        '检测到裸 `tsc`（未通过 `npx tsc` / `pnpm exec tsc` / `yarn dlx tsc` 或 `node_modules/.bin/` 路径调用）。请在 command 中改为 `npx tsc ...`，避免依赖全局安装的旧版 TypeScript。',
    });
  }
  if (hasTscToken(command) && !hasProjectStyleFlag(command)) {
    issues.push({
      code: 'bare-tsc-without-project',
      message:
        '检测到 `tsc` 但未使用 `-p` / `--project` 或 `-b` 指定工程。请改为例如 `npx tsc -p tsconfig.json ...`，避免隐式目录/版本漂移。',
    });
  }
  return issues;
}

/** 危险 shell 模式（D7）；强度由 stagent.execution.dangerousCommandLint 控制。 */
export function detectDangerousShellCommandIssues(command: string): CodeRunnerCommandIssue[] {
  const issues: CodeRunnerCommandIssue[] = [];
  if (typeof command !== 'string' || command.length === 0) {
    return issues;
  }
  if (/\brm\s+-rf\s+\/\s*/.test(command) || /\brm\s+-rf\s+~\s*/.test(command)) {
    issues.push({
      code: 'dangerous-rm-rf-root',
      message: 'command 含 `rm -rf /` 或 `rm -rf ~` 等根目录删除，已阻断。',
    });
  }
  if (/\bcurl\b[^\n|]*\|\s*(ba)?sh\b/i.test(command) || /\bwget\b[^\n|]*\|\s*(ba)?sh\b/i.test(command)) {
    issues.push({
      code: 'dangerous-curl-pipe-shell',
      message: 'command 含 curl/wget 管道到 shell，已阻断。',
    });
  }
  if (/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/.test(command)) {
    issues.push({
      code: 'dangerous-fork-bomb',
      message: 'command 含 fork bomb 模式，已阻断。',
    });
  }
  return issues;
}

export function isDangerousCommandIssue(issue: CodeRunnerCommandIssue): boolean {
  return issue.code.startsWith('dangerous-');
}

/** 依赖 stages 线性顺序与 meta.taskWorkspacePath（与生成期校验一致；DAG 模式下若阶段实际顺序与数组不一致可能漏报/误报）。 */
function detectCodeRunnerWorkflowLintIssues(
  command: string,
  wf: WorkflowDefinition,
  stageIndex: number,
): CodeRunnerCommandIssue[] {
  const issues: CodeRunnerCommandIssue[] = [];
  if (typeof command !== 'string' || !hasTscToken(command)) {
    return issues;
  }
  if (!commandSelfHasDependencyInstall(command) && !priorLinearStagesHadNpmInstall(wf.stages, stageIndex)) {
    issues.push({
      code: 'missing-npm-install-before-tsc',
      message:
        'command 含 `tsc`，但此前线性顺序中未见 `npm install` / `npm ci` / `pnpm install` / `yarn` 等依赖安装类 code-runner，且本条 command 内也未串联 install。若子项目尚未装依赖，请先 `npm ci` 或 `npm install` 再编译。',
    });
  }
  issues.push(...detectImportMetaUrlVsCommonJsWorkspace(wf.meta?.taskWorkspacePath));
  return issues;
}

export function collectAllCodeRunnerLintIssues(
  command: string,
  wf: WorkflowDefinition,
  stageIndex: number,
): CodeRunnerCommandIssue[] {
  const issues = [...detectCodeRunnerCommandIssues(command), ...detectCodeRunnerWorkflowLintIssues(command, wf, stageIndex)];
  if (readDangerousCommandLintMode() !== 'off') {
    issues.push(...detectDangerousShellCommandIssues(command));
  }
  const stage = wf.stages?.[stageIndex];
  if (stage && /^stage_test_run_/.test(stage.id) && stage.tool === 'code-runner') {
    const registry = collectWorkflowArtifacts(wf);
    issues.push(...detectPythonImportLintIssues(command, registry, { stageId: stage.id }));
  }
  return issues;
}

export function formatCodeRunnerCommandIssue(stageId: string, issue: CodeRunnerCommandIssue): string {
  return `工具配置错误：阶段 ${stageId} (code-runner) [${issue.code}] ${issue.message}`;
}

/** 生成期 warn 模式：将危险命令写入 workflowGenerated.warnings。 */
export function collectDangerousCommandWarningsForWorkflow(wf: WorkflowDefinition): string[] {
  if (readDangerousCommandLintMode() !== 'warn') {
    return [];
  }
  const lines: string[] = [];
  for (const stage of wf.stages ?? []) {
    if (!isCodeRunnerTool(stage.tool)) {
      continue;
    }
    const cfg = stage.toolConfig as { command?: string };
    const cmd = String(cfg.command ?? '');
    for (const issue of detectDangerousShellCommandIssues(cmd)) {
      lines.push(`dangerous-cmd:${issue.code}:${stage.id}`);
    }
  }
  return lines;
}
