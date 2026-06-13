/** 宿主输出通道窄接口（VS Code OutputChannel / autoAI log sink）。 */
export type EngineOutputChannel = { appendLine: (value: string) => void };

/**
 * 引擎级可变运行时状态（原先散落在 WorkflowEngine 上的可变字段）。
 * 集中持有后，连线闭包通过该对象读写，无需回指 `this`。
 */
export class EngineRuntimeState {
  executionDepth = 0;
  outputChannel: EngineOutputChannel | undefined;
  /** onGlobalStateFailed 磁盘兜底重写的重入保护（按 instanceKey）。 */
  readonly globalStateRewriteInFlight = new Set<string>();

  constructor(public preferredModelFamily: string) {}
}
