import type { Stage } from '../WorkflowDefinition';
import { STAGE_TOOL_CODE_RUNNER } from '../workflow/StageToolKinds';
import { NPM_INIT_LOG_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { STAGE_INIT_NPM_WORKSPACE_ID } from './constants';

function createInitNpmStage(): Stage {
  return {
    id: STAGE_INIT_NPM_WORKSPACE_ID,
    title: '初始化 npm 子项目（工作区根）',
    description:
      '在用户填写的工作文件夹根目录执行 npm init -y；若生成 npm 默认的失败型 test 脚本，引擎会随后自动替换为占位通过，避免后续 npm test 阶段误失败。建议工作文件夹指向已建好的子目录（如 task/qr-app/），避免在无关仓库根目录执行。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig: {
      type: STAGE_TOOL_CODE_RUNNER,
      command: 'npm init -y',
      captureOutput: true,
      pathBase: 'workspace',
      workingDir: '.',
    },
    input: {
      sources: [{ type: 'user-input', label: '用户任务' }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: NPM_INIT_LOG_OUTPUT_KEY, format: 'text' }],
    pauseAfter: false,
  };
}

export function injectInitNpmWorkspaceStage(stages: Stage[]): Stage[] {
  if (stages.some((s) => s.id === STAGE_INIT_NPM_WORKSPACE_ID)) {
    return stages;
  }
  return [createInitNpmStage(), ...stages];
}

const NODE_JS_BOOTSTRAP_STAGE_IDS = new Set([
  STAGE_INIT_NPM_WORKSPACE_ID,
  'stage_npm_install_server',
]);

/** Python 栈工作流：移除 LLM 或历史注入残留的 npm init / server npm install 阶段。 */
export function stripNodeJsBootstrapStages(stages: Stage[]): Stage[] {
  return stages.filter((s) => !NODE_JS_BOOTSTRAP_STAGE_IDS.has(s.id));
}
