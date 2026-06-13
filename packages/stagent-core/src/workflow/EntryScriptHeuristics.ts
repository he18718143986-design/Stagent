/**
 * 入口脚本 / main assembly 命令启发式（webview-safe，无 WorkflowDefinition 依赖）。
 * 供 plan-completeness、Rule20 prototype、PrototypeContractLint 共享。
 */

const PROTOTYPE_ENTRY_SCRIPT_IN_COMMAND =
  /\b(?:main|app|monitor|run|cli|server|index|manage|start|__main__)\.(?:py|js|ts|mjs|cjs)\b/i;

const INTEGRATION_ENTRY_SCRIPT_IN_COMMAND = /\b(main|monitor|pipeline)\.py\b/i;

const INTEGRATION_STAGE_ID_SUFFIX = /_main\b|_mock_pipeline\b|_pipeline\b/i;

/** code-runner 命令是否指向 main assembly / 应用入口（plan-completeness 门控）。 */
export function matchesMainAssemblyCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) {
    return false;
  }
  if (/\b(npm|yarn|pnpm)\s+start\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(npm|yarn|pnpm)\s+run\s+start\b/i.test(trimmed)) {
    return true;
  }
  if (/\bnpx\s+expo\s+(start|prebuild)\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(main|app|run|cli|index|monitor|start)\.(py|ts|tsx|js|jsx)\b/i.test(trimmed)) {
    return true;
  }
  if (/\bnode\s+[^\s;|&]+\/(index|main)\.(js|ts|mjs|cjs)\b/i.test(trimmed)) {
    return true;
  }
  if (/\bpython3?\s+[^\s;|&]*(main|__main__)\.py\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

/** 命令是否引用 prototype 入口脚本（Rule20 prototype 下游 runner 消费判定）。 */
export function matchesPrototypeEntryScriptInCommand(cmd: string): boolean {
  return PROTOTYPE_ENTRY_SCRIPT_IN_COMMAND.test(cmd);
}

/** 集成 test_run 是否跑 main / pipeline / monitor 入口（PrototypeContractLint）。 */
export function matchesIntegrationTestRunCommand(cmd: string, stageId: string): boolean {
  return INTEGRATION_ENTRY_SCRIPT_IN_COMMAND.test(cmd) || INTEGRATION_STAGE_ID_SUFFIX.test(stageId);
}
