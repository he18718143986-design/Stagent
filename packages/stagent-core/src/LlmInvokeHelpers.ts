/** 与 `package.json` → `stagent.llmTimeoutSeconds` 默认值一致 */
export const DEFAULT_LLM_TIMEOUT_SECONDS = 180;

/** 与 `package.json` → `stagent.llmMaxOutputTokens` 默认值一致（Direct API chat/completions max_tokens） */
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 16_384;

const MIN_LLM_TIMEOUT_SECONDS = 30;
const MAX_LLM_TIMEOUT_SECONDS = 600;
const MIN_LLM_MAX_OUTPUT_TOKENS = 1024;
const MAX_LLM_MAX_OUTPUT_TOKENS = 65_536;

export function resolveLlmTimeoutSeconds(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(MAX_LLM_TIMEOUT_SECONDS, Math.max(MIN_LLM_TIMEOUT_SECONDS, Math.floor(raw)));
  }
  return DEFAULT_LLM_TIMEOUT_SECONDS;
}

export function resolveLlmMaxOutputTokens(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(
      MAX_LLM_MAX_OUTPUT_TOKENS,
      Math.max(MIN_LLM_MAX_OUTPUT_TOKENS, Math.floor(raw)),
    );
  }
  return DEFAULT_LLM_MAX_OUTPUT_TOKENS;
}

/** 拼装 raw LLM 调用的提示：系统指令 + 用户输入。 */
export function buildLlmInvokePrompt(systemPrompt: string, userContent: string): string {
  return `系统指令：\n${systemPrompt}\n\n用户输入：\n${userContent}`;
}

/** 模型疑似拒答时的二次追加提示（要求继续完成、给出可执行假设）。 */
export function buildLlmRefusalRetryPrompt(prompt: string): string {
  return `${prompt}\n\n补充要求：请继续完成任务。若信息不足，请提出可执行假设并给出结构化输出，禁止只返回拒绝句。`;
}

/**
 * JSON 修复提示：上次输出无法解析为合法 JSON 时追加，要求仅输出纯 JSON。
 * 用于浏览器 AI 包 markdown / 加解释 / 截断等场景的有界修复重试。
 */
export function buildJsonRepairPrompt(raw: string): string {
  return (
    '你上次的输出无法被解析为合法的 JSON 对象。\n' +
    '请只输出一个 JSON 对象本身：不要任何解释、不要前后缀文字、不要 ``` 代码围栏、不要省略号。\n' +
    '若上次内容被截断，请输出完整且闭合的 JSON。\n\n' +
    `上次输出：\n${raw}`
  );
}

/**
 * JSON 截断续写提示（#1 进阶）：上次 JSON 被截断时追加，要求「仅接续剩余部分」。
 * 返回内容将与上次输出拼接后再解析，故强调不要重复、不要解释、不要围栏。
 */
export function buildJsonContinuationPrompt(partial: string): string {
  return (
    '你上次的 JSON 输出在结束前被截断了。\n' +
    '请仅输出「剩余未完成的部分」，从截断处精确续写，使其与上次内容拼接后构成完整且闭合的 JSON。\n' +
    '不要重复任何已经输出过的内容，不要解释，不要 ``` 代码围栏。\n\n' +
    `上次已输出（在此基础上继续）：\n${partial}`
  );
}

/** 将 fetch / CancellationToken 的 aborted 转为用户可读中文 */
export function formatLlmUserFacingError(err: unknown, idleMs: number): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes('aborted') ||
    lower.includes('abort') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  ) {
    const sec = Math.round(idleMs / 1000);
    return (
      `LLM 流式响应中断：连续约 ${sec} 秒未收到任何新增内容，已判定为卡死并取消。` +
      `只要模型在持续输出就不会触发该超时；出现此提示通常是网络中断或服务端停止响应。` +
      `请重试，或在设置中调整 stagent.llmTimeoutSeconds（空闲上限，最大 600），或侧栏选用更稳定的模型。`
    );
  }
  return raw;
}

/** 注入式定时器，便于单测用假时钟驱动空闲超时逻辑。 */
export interface IdleTimers {
  set(handler: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface IdleTimeoutHandle {
  /** 收到新增量时调用：重置空闲计时（已触发后再调用无效）。 */
  reset(): void;
  /** 流正常结束 / 出错时调用：停止计时。 */
  clear(): void;
}

const REAL_IDLE_TIMERS: IdleTimers = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * 空闲超时：替代「总时长超时」。只要持续收到增量就不触发；
 * 仅当连续 `idleMs` 毫秒没有任何新增量才调用 `onIdle`（用于 abort/cancel）。
 * 这样仍在持续产出的长输出永远不会被误杀，只有真正卡死才被取消。
 */
export function createIdleTimeout(
  idleMs: number,
  onIdle: () => void,
  timers: IdleTimers = REAL_IDLE_TIMERS,
): IdleTimeoutHandle {
  let handle: unknown = null;
  let fired = false;
  const arm = (): void => {
    handle = timers.set(() => {
      fired = true;
      handle = null;
      onIdle();
    }, idleMs);
  };
  const disarm = (): void => {
    if (handle !== null) {
      timers.clear(handle);
      handle = null;
    }
  };
  arm();
  return {
    reset(): void {
      if (fired) {
        return;
      }
      disarm();
      arm();
    },
    clear(): void {
      disarm();
    },
  };
}
