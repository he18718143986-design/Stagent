import { uiMsg } from '../../l10n/uiStrings';
import { ERROR_TYPE_TOOL_EXECUTION_FAILED } from '../stageErrorBuilders';

export type ToolExecutionUserCategory = 'environment' | 'code' | 'generic';

export interface ToolExecutionCopyInput {
  rawError: string;
  stderr?: string;
  stageId?: string;
}

export interface ToolExecutionCopyResult {
  title: string;
  userBody: string;
  playbookSteps: string[];
  userCategory: ToolExecutionUserCategory;
  exitCode?: number;
  weakenRetry: boolean;
}

/** 从 code-runner 错误文案解析 exitCode（如 `exitCode=127`）。 */
export function parseCodeRunnerExitCode(rawError: string): number | undefined {
  const m = rawError.match(/exitCode=(\d+)/);
  if (!m) {
    return undefined;
  }
  const code = Number.parseInt(m[1]!, 10);
  return Number.isFinite(code) ? code : undefined;
}

/** 从 stderr / 错误文本推断缺失的命令名。 */
export function detectMissingCommand(text: string): string | undefined {
  const patterns = [
    /(?:^|[\s:])([A-Za-z0-9._-]+):\s*command not found/m,
    /env:\s*([A-Za-z0-9._-]+):\s*No such file or directory/m,
    /not found:\s*([A-Za-z0-9._-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1] && m[1] !== 'sh' && m[1] !== 'env') {
      return m[1];
    }
  }
  return undefined;
}

/** 从阶段 id 推断可能缺失的工具（stderr 无信息时的兜底）。 */
export function inferToolFromStageId(stageId?: string): string | undefined {
  if (!stageId) {
    return undefined;
  }
  const id = stageId.toLowerCase();
  if (id.includes('flutter') || id.includes('mobile') || id.includes('chat_ui') || id.includes('widget_test')) {
    return 'flutter';
  }
  if (id.includes('npm') || id.includes('node')) {
    return 'npm';
  }
  if (id.includes('python') || id.includes('pip')) {
    return 'python';
  }
  if (id.includes('docker')) {
    return 'docker';
  }
  return undefined;
}

function formatCommandNotFoundCopy(input: ToolExecutionCopyInput): ToolExecutionCopyResult {
  const haystack = [input.stderr, input.rawError].filter(Boolean).join('\n');
  const tool =
    detectMissingCommand(haystack) ??
    inferToolFromStageId(input.stageId) ??
    'command';

  const title =
    tool === 'command'
      ? uiMsg('stagent.error.catalog.commandNotFound.titleGeneric')
      : uiMsg('stagent.error.catalog.commandNotFound.title', tool);

  const userBody =
    tool === 'command'
      ? uiMsg('stagent.error.catalog.commandNotFound.bodyGeneric')
      : uiMsg('stagent.error.catalog.commandNotFound.body', tool);

  const playbookSteps =
    tool === 'command'
      ? [
          uiMsg('stagent.error.catalog.commandNotFound.playbookGeneric.1'),
          uiMsg('stagent.error.catalog.commandNotFound.playbookGeneric.2'),
          uiMsg('stagent.error.catalog.commandNotFound.playbookGeneric.3'),
        ]
      : [
          uiMsg('stagent.error.catalog.commandNotFound.playbook.1', tool),
          uiMsg('stagent.error.catalog.commandNotFound.playbook.2'),
          uiMsg('stagent.error.catalog.commandNotFound.playbook.3'),
        ];

  return {
    title,
    userBody,
    playbookSteps,
    userCategory: 'environment',
    exitCode: 127,
    weakenRetry: true,
  };
}

function formatCommandFailedCopy(exitCode: number): ToolExecutionCopyResult {
  return {
    title: uiMsg('stagent.error.catalog.commandFailedCode.title'),
    userBody: uiMsg('stagent.error.catalog.commandFailedCode.body'),
    playbookSteps: [
      uiMsg('stagent.error.catalog.commandFailedCode.playbook.1'),
      uiMsg('stagent.error.catalog.commandFailedCode.playbook.2'),
      uiMsg('stagent.error.catalog.commandFailedCode.playbook.3'),
    ],
    userCategory: 'code',
    exitCode,
    weakenRetry: false,
  };
}

/** tool-execution-failed 的用户向文案分流（127 环境 / 1 代码 / 其它 generic）。 */
export function formatToolExecutionFailedCopy(input: ToolExecutionCopyInput): ToolExecutionCopyResult {
  const exitCode = parseCodeRunnerExitCode(input.rawError);
  if (exitCode === 127) {
    return formatCommandNotFoundCopy(input);
  }
  if (exitCode === 1) {
    return formatCommandFailedCopy(1);
  }
  return {
    title: uiMsg('stagent.error.catalog.toolExecutionFailed.title'),
    userBody: uiMsg('stagent.error.catalog.toolExecutionFailed.hint'),
    playbookSteps: [
      uiMsg('stagent.error.catalog.toolExecutionFailed.playbook.1'),
      uiMsg('stagent.error.catalog.toolExecutionFailed.playbook.2'),
      uiMsg('stagent.error.catalog.toolExecutionFailed.playbook.3'),
    ],
    userCategory: 'generic',
    exitCode,
    weakenRetry: false,
  };
}

export function isToolExecutionFailedType(errorType: string): boolean {
  return errorType === ERROR_TYPE_TOOL_EXECUTION_FAILED;
}
