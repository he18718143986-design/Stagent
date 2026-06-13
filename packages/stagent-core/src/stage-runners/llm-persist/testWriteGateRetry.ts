/**
 * P1（T4 Run #22 根治配套）：post test_write 质量门禁 block 后，同 stage 带 gate
 * 反馈自动重写测试（≤ MAX 次），耗尽才走 failWorkflowStageFromGate 终态。
 *
 * 动机：fix 链（fix_if_failed）按 TDD 纪律不可修改 test；若测试本身是假绿
 * （弱断言 / sys.modules 劫持），fix 结构性不可达。唯一出路是在 test_write
 * 阶段内重写测试，而非加长 fix 链。
 */

/** 同 stage gate 重试上限（不含首次）；耗尽后终态失败。 */
export const MAX_TEST_WRITE_GATE_RETRIES = 2;

/** 重试计数与 gate 报告落点（runtime.outputs，随实例持久化，可审计）。 */
export const TEST_WRITE_GATE_RETRY_OUTPUT_KEY = '_testWriteGateRetry';

export interface TestWriteGateRetryState {
  attempts: number;
  lastMessages: string[];
}

/** 控制流信号：post test_write gate block，本 stage 还有重试额度。 */
export class TestWriteGateBlockedError extends Error {
  constructor(readonly messages: string[]) {
    super(`test-write-gate-blocked: ${messages.join('; ')}`);
    this.name = 'TestWriteGateBlockedError';
  }
}

export function readTestWriteGateRetryState(
  outputs: Record<string, unknown>,
): TestWriteGateRetryState {
  const raw = outputs[TEST_WRITE_GATE_RETRY_OUTPUT_KEY];
  if (raw && typeof raw === 'object') {
    const o = raw as Partial<TestWriteGateRetryState>;
    return {
      attempts: typeof o.attempts === 'number' && o.attempts >= 0 ? Math.floor(o.attempts) : 0,
      lastMessages: Array.isArray(o.lastMessages) ? o.lastMessages.map(String) : [],
    };
  }
  return { attempts: 0, lastMessages: [] };
}

export function recordTestWriteGateRetry(
  outputs: Record<string, unknown>,
  messages: string[],
): TestWriteGateRetryState {
  const prev = readTestWriteGateRetryState(outputs);
  const next: TestWriteGateRetryState = {
    attempts: prev.attempts + 1,
    lastMessages: messages,
  };
  outputs[TEST_WRITE_GATE_RETRY_OUTPUT_KEY] = next;
  return next;
}

const RETRY_RULES = [
  '断言必须验证真实行为/输出/数据（具体返回值、列名、状态码、抛错类型），禁止仅 `assert x is not None` 或 `assert True`。',
  '禁止通过 `sys.modules[...] = ...`、`sys.modules.setdefault(...)`、`monkeypatch.setitem(sys.modules, ...)` 劫持/替换被测项目模块。',
  '禁止在测试文件内定义生产类的内联替身（Test Double）来代替真实模块；必须 `from <被测模块> import <契约导出>` 并直接调用。',
  '禁止 NaN 身份比较（`is np.nan`）；用 `np.isnan()` / `pd.isna()`。',
  '禁止匹配内置异常的消息原文（`pytest.raises(AttributeError, match=…)` 等）；消息随 Python 版本变化。',
  '禁止断言数学上不可保证的数值巧合（如指标交叉点幅度阈值、随机数据统计阈值）。',
  '仅 import 已声明第三方依赖（见 system 中的依赖 SSOT）与项目内模块；未声明包（如 yaml 无 pyyaml）禁止 import。',
  '每个测试函数至少包含一个行为级断言。',
  'mock.patch/mocker.patch 跨模块目标必须是 gate 或 system 中「允许：」列表里的 `<模块>.<export>`；禁止 patch compute/check_multi/evaluate 等未声明符号。',
  'from main import 仅 main 切片 exports 已声明符号；exports 无 main 时禁止 import main。',
].join('\n- ');

/** gate 重试注入 system prompt 的追加段。 */
export function buildTestWriteGateRetrySystemAppend(messages: string[]): string {
  return [
    '【测试质量门禁重写要求】你上一版测试代码被质量门禁拒绝，原因：',
    ...messages.map((m) => `- ${m}`),
    '',
    '请重写完整测试文件，必须遵守：',
    `- ${RETRY_RULES}`,
  ].join('\n');
}

/** gate 重试注入 user content 的追加段。 */
export function buildTestWriteGateRetryUserAppend(): string {
  return '【重要】上一版测试因质量门禁被拒（见 system 提示中的具体原因）。请输出修正后的完整测试文件内容，不要输出解释。';
}
