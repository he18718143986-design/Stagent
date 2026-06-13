import type { Stage } from '../../WorkflowDefinition';

export const KNOWN_TOOLS = new Set(['llm-text', 'code-runner', 'file-read', 'file-write']);
export const UNSUPPORTED_DECLARED_TOOLS = new Set(['user-prompt']);

export function isValidKnownToolStage(stage: Stage): boolean {
  return !!(stage.tool && KNOWN_TOOLS.has(stage.tool) && !UNSUPPORTED_DECLARED_TOOLS.has(stage.tool));
}

export function validateToolPresence(stage: Stage): string[] {
  if (stage.tool && UNSUPPORTED_DECLARED_TOOLS.has(stage.tool)) {
    return [
      `阶段 ${stage.id} 使用了未实现的工具类型 '${stage.tool}'：执行器不支持交互式 user-prompt，` +
        `请改用 isDecisionStage（决策审阅）或 questionBefore / questionAfter（结构化追问）表达人工介入`,
    ];
  }
  if (!stage.tool || !KNOWN_TOOLS.has(stage.tool)) {
    return [
      `阶段 ${stage.id} 缺少有效的 tool 字段（当前为 ${JSON.stringify(
        stage.tool,
      )}）：生成可能被截断，请重新生成工作流`,
    ];
  }
  return [];
}
