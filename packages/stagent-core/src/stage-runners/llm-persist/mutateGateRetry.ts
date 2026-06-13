/**
 * P2（T4 Run #26 根治）：post impl/fix module-contract / declared-deps gate block 后，
 * 同 stage 带 gate 反馈重写实现（≤ MAX 次），避免一次 export-extra 即 workflowFailed。
 */

import { isFixIfFailedStageId } from '../../runtime-replan/FixExhaustedRouter';
import { isImplStageId } from '../../workflow/StageIdPatterns';

/** 同 stage gate 重试上限（不含首次）；耗尽后终态失败。 */
export const MAX_MUTATE_GATE_RETRIES = 2;

export const MUTATE_GATE_RETRY_OUTPUT_KEY = '_mutateGateRetry';

export interface MutateGateRetryState {
  attempts: number;
  lastMessages: string[];
}

/** 控制流信号：post impl/fix gate block，本 stage 还有重试额度。 */
export class MutateGateBlockedError extends Error {
  constructor(readonly messages: string[]) {
    super(`mutate-gate-blocked: ${messages.join('; ')}`);
    this.name = 'MutateGateBlockedError';
  }
}

export function isMutateAuthoringStageId(stageId: string): boolean {
  return isImplStageId(stageId) || isFixIfFailedStageId(stageId);
}

export function readMutateGateRetryState(outputs: Record<string, unknown>): MutateGateRetryState {
  const raw = outputs[MUTATE_GATE_RETRY_OUTPUT_KEY];
  if (raw && typeof raw === 'object') {
    const o = raw as Partial<MutateGateRetryState>;
    return {
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0,
      lastMessages: Array.isArray(o.lastMessages) ? o.lastMessages.map(String) : [],
    };
  }
  return { attempts: 0, lastMessages: [] };
}

export function recordMutateGateRetry(
  outputs: Record<string, unknown>,
  messages: string[],
): MutateGateRetryState {
  const prev = readMutateGateRetryState(outputs);
  const next: MutateGateRetryState = {
    attempts: prev.attempts + 1,
    lastMessages: messages,
  };
  outputs[MUTATE_GATE_RETRY_OUTPUT_KEY] = next;
  return next;
}

const RETRY_RULES = [
  '模块顶层仅 def/class 导出契约 exports 符号；内部 helper 必须 `_` 前缀或嵌套在函数/类内。',
  '禁止模块级未声明的 class/def（如 DataPipeline）——应改为 `_DataPipeline` 或嵌套在 create_pipeline 内。',
  '仅 import 已声明第三方依赖（见 system 中的依赖 SSOT）与项目内模块；禁止未声明包。',
  '对齐已落盘测试的 import 与断言语义；禁止修改测试文件。',
  '入口脚本（main.py）读取 config 时只能使用架构 decisionArtifacts config.yaml 已定义键；禁止发明 data 等未列出顶层键。',
  '禁止在 main.py 模块级定义其它切片符号（SimBroker/compute_indicators 等）以满足测试 patch；从 broker/indicators 等 import 并在函数内使用。',
  '禁止 config.get("compute_indicators") 等同名 DI 注入函数；直接 import 模块符号，config 只承载 YAML 数据键。',
].join('\n- ');

function buildConfigContractMutateRetryAppend(messages: string[]): string | undefined {
  const isConfigContract = messages.some(
    (m) => m.includes('config.yaml') || m.includes('未定义该键'),
  );
  if (!isConfigContract) {
    return undefined;
  }
  return [
    '【config 键契约专项修正】',
    '你使用了架构 config.yaml 中不存在的顶层键。必须改为嵌套访问：',
    '- RiskManager → cfg["risk"]（非 cfg["modules"]["risk"]）',
    '- SimBroker 初始资金 → cfg["broker"]["sim"]["initial_balance"]（非 cfg["trade"]["initial_capital"]）',
    '- 信号参数 → cfg["signals"]（非 cfg["modules"]["signals"]）',
    '- 日志 → cfg["logging"]',
    '- 模拟 K 线 → 内置 _DataGenerator，勿读 cfg["data_source"]',
    '- 轮询间隔 → 模块常量或 cfg["periods"]，勿读 cfg["trade"]["interval_seconds"]',
    '删除所有 trade、modules、data_source 顶层访问；仅使用 gate 消息中「现有键」列表里的嵌套路径。',
  ].join('\n');
}

export function buildMutateGateRetrySystemAppend(messages: string[]): string {
  const configAppend = buildConfigContractMutateRetryAppend(messages);
  return [
    '【impl/fix 质量门禁重写要求】你上一版实现被质量门禁拒绝，原因：',
    ...messages.map((m) => `- ${m}`),
    '',
    ...(configAppend ? [configAppend, ''] : []),
    '请重写完整实现文件，必须遵守：',
    `- ${RETRY_RULES}`,
  ].join('\n');
}

export function buildMutateGateRetryUserAppend(): string {
  return '【重要】上一版实现因质量门禁被拒（见 system 提示）。请输出修正后的完整文件内容，不要输出解释。';
}
