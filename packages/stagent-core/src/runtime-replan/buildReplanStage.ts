import type { CodeRunnerConfig, LlmTextConfig, Stage } from '../WorkflowDefinition';
import { CONFTEST_TEMPLATE } from '../python-bootstrap/conftestTemplate';
import { STAGE_TOOL_CODE_RUNNER, STAGE_TOOL_LLM_TEXT } from '../workflow/StageToolKinds';
import {
  RUNTIME_REPLAN_MARKER,
  RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX,
  RUNTIME_REPLAN_STAGE_ID_PREFIX,
  RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX,
} from './constants';
import type { RuntimeReplanTrigger } from './types';

/** testfix 通用假红修复规则（T4 Run #45：_set_ideal_* 覆盖先前列赋值）。 */
const TESTFIX_REWRITE_COMMON_RULES = [
  '若测试先给 df 列赋值再调用 _set_ideal_short_df / _set_ideal_long_df 等 setup 助手，助手会覆盖 MA/指标列；边界用例须在助手调用之后再覆盖目标列。',
  '禁止在助手调用之前设置边界值却被助手静默覆盖——这是常见假红根因。',
];

/** signals 切片 testfix/impl 对齐专项（均线并拢严格小于 2 tick）。 */
function signalsSliceReplanRules(semantic: string): string[] {
  if (semantic !== 'signals') {
    return [];
  }
  return [
    'signals 均线并拢：impl 判定 max(ma5..ma9)-min(ma5..ma9) < 2*MIN_TICK（严格小于）；恰好 2 tick 间距不算并拢，不得触发信号。',
    '测试边界用例「exactly 2 tick no signal」：先 _set_ideal_* 再覆盖 ma5..ma9 使 spread=2*MIN_TICK，勿在助手之前赋值。',
  ];
}

function baseStage(opts: {
  id: string;
  title: string;
  description: string;
  tool: Stage['tool'];
  toolConfig: CodeRunnerConfig | LlmTextConfig;
  dependsOn: string[];
}): Stage {
  return {
    id: opts.id,
    title: opts.title,
    description: `${RUNTIME_REPLAN_MARKER} ${opts.description}`,
    tool: opts.tool,
    toolConfig: opts.toolConfig,
    dependsOn: opts.dependsOn,
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'replanOut', format: 'text' }],
    pauseAfter: false,
  };
}

export function buildConftestReplanStage(opts: {
  semantic: string;
  anchorStageId: string;
}): Stage {
  const id = `${RUNTIME_REPLAN_STAGE_ID_PREFIX}conftest_${opts.semantic}`;
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      'preflight 检出 flat layout 缺少 conftest.py；写入以下模板到 conftest.py。',
      '不要修改内容，不要添加说明。',
      CONFTEST_TEMPLATE.trim(),
    ].join('\n'),
    writeOutputToFile: 'conftest.py',
    writePathBase: 'workspace',
  };
  return baseStage({
    id,
    title: `写入 conftest.py（${opts.semantic}）`,
    description: 'preflight 缺少 conftest.py；runtime replan 插入 conftest 阶段。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}

export function buildPipPytestAsyncioReplanStage(opts: {
  semantic: string;
  anchorStageId: string;
}): Stage {
  const id = `${RUNTIME_REPLAN_STAGE_ID_PREFIX}pip_pytest_asyncio_${opts.semantic}`;
  const toolConfig: CodeRunnerConfig = {
    type: STAGE_TOOL_CODE_RUNNER,
    command: '.venv/bin/pip install "pytest-asyncio>=0.23.0"',
    captureOutput: true,
    pathBase: 'workspace',
    workingDir: '.',
  };
  return baseStage({
    id,
    title: `安装 pytest-asyncio（${opts.semantic}）`,
    description: 'preflight 检出缺少 pytest-asyncio；运行时 replan 插入 pip 阶段。',
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}

export function buildFixExhaustedReplanStage(opts: {
  semantic: string;
  anchorStageId: string;
  writeTarget: string;
  trigger: RuntimeReplanTrigger;
}): Stage {
  const id = `${RUNTIME_REPLAN_STAGE_ID_PREFIX}fix_${opts.semantic}`;
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      `stage_fix_if_failed_${opts.semantic} 已达上限仍未能使 test_run 通过；执行 runtime-replan 升级修复。`,
      `只输出完整文件 ${opts.writeTarget}；禁止 Markdown 围栏。`,
      '阅读 test_run 失败输出与下方注入的已落盘测试全文，逐条满足 assert/raises 语义；勿臆造第三方符号。',
      '测试用 prev_* 列（如 prev_vol_ma_short、prev_macd_hist、prev_cci）表达动态条件时，impl 必须读取 row 中同名字段并实现对应比较逻辑。',
      opts.trigger.message ? `test_run 输出摘要：\n${opts.trigger.message}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    writeOutputToFile: opts.writeTarget,
    writePathBase: 'workspace',
  };
  return baseStage({
    id,
    title: `Fix replan 升级（${opts.semantic}）`,
    description: `fix-exhausted：fix_if_failed 仍红`,
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}

/**
 * fix-exhausted 升级链第 3 级（T4 Run #29 根治）：testfix 重写测试后仍红
 * → impl 必须按**新测试**逐条对齐（测试为行为 SSOT）。
 */
export function buildPostTestfixImplReplanStage(opts: {
  semantic: string;
  anchorStageId: string;
  writeTarget: string;
  trigger: RuntimeReplanTrigger;
}): Stage {
  const id = `${RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX}${opts.semantic}`;
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      `testfix 已重写 tests/test_${opts.semantic}.py，但 stage_test_run_${opts.semantic} 仍失败；执行 impl 对齐修复。`,
      `只输出完整文件 ${opts.writeTarget}；禁止 Markdown 围栏；禁止修改测试文件。`,
      '已落盘测试为行为 SSOT：逐条满足全部 parametrize 场景与 generate_signals 集成断言。',
      '测试用 prev_* 列表达动态条件时，impl 必须读取 row 中同名字段（禁止仅用当前列近似）。',
      ...signalsSliceReplanRules(opts.semantic),
      opts.trigger.message ? `test_run 输出摘要：\n${opts.trigger.message}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    writeOutputToFile: opts.writeTarget,
    writePathBase: 'workspace',
  };
  return baseStage({
    id,
    title: `Post-testfix impl 对齐（${opts.semantic}）`,
    description: 'fix-exhausted 升级：testfix 后仍红，按新测试对齐 impl',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}

/**
 * fix-exhausted 升级链第 2 级（T4 Run #23 根治）：impl replan 后 test_run 仍红
 * → 测试本身假红嫌疑（脆弱断言），条件允许重写测试（PRD EQ-4 选项 B）。
 */
export function buildTestRewriteReplanStage(opts: {
  semantic: string;
  anchorStageId: string;
  writeTarget: string;
  trigger: RuntimeReplanTrigger;
}): Stage {
  const id = `${RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX}${opts.semantic}`;
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      `fix 链与 impl 升级修复均未能使 stage_test_run_${opts.semantic} 通过；判定测试文件本身可能存在缺陷（假红），执行测试重写。`,
      `只输出完整文件 ${opts.writeTarget}；禁止 Markdown 围栏。`,
      '阅读 pytest 失败输出，保留验证真实契约行为的断言，重写以下脆弱断言：',
      '- 禁止 `is np.nan` / `is not np.nan` 身份比较（NaN 无单例保证；用 np.isnan() / pd.isna()）。',
      '- 禁止匹配内置异常（AttributeError/TypeError/ValueError 等）的消息原文（随 Python 版本变化；pytest.raises 不带 match 即可）。',
      '- 禁止断言数学上不可保证的数值巧合（如指标交叉点幅度阈值、随机数据统计均值阈值）。',
      '重写后仍必须是行为级测试：',
      '- 断言具体返回值/列名/形状/状态；禁止退化为仅 `assert x is not None` / `assert True`。',
      '- 禁止 sys.modules 劫持项目模块；禁止在测试内定义生产类替身。',
      ...TESTFIX_REWRITE_COMMON_RULES,
      ...signalsSliceReplanRules(opts.semantic),
      opts.trigger.message ? `test_run 输出摘要：\n${opts.trigger.message}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    writeOutputToFile: opts.writeTarget,
    writePathBase: 'workspace',
  };
  return baseStage({
    id,
    title: `测试重写 replan（${opts.semantic}）`,
    description: 'fix-exhausted 升级：impl replan 后仍红，重写假红嫌疑测试。',
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}

export function buildGateReplanLlmStage(opts: {
  semantic: string;
  anchorStageId: string;
  writeTarget: string;
  trigger: RuntimeReplanTrigger;
}): Stage {
  const id = `${RUNTIME_REPLAN_STAGE_ID_PREFIX}gate_${opts.semantic}`;
  const toolConfig: LlmTextConfig = {
    type: STAGE_TOOL_LLM_TEXT,
    systemPrompt: [
      `gate-repair 未能通过 ${opts.trigger.gateId ?? 'gate'}；执行 runtime-replan 修复。`,
      `只输出完整文件 ${opts.writeTarget}；禁止 Markdown 围栏。`,
      '对齐 test import 与 impl 导出；移除第三方幻觉 API（如 MdApi）。',
      opts.trigger.message ? `Gate 消息：${opts.trigger.message}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    writeOutputToFile: opts.writeTarget,
    writePathBase: 'workspace',
  };
  return baseStage({
    id,
    title: `Gate replan 修复（${opts.semantic}）`,
    description: `gate-repair-exhausted：${opts.trigger.gateId ?? 'gate'}`,
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig,
    dependsOn: [opts.anchorStageId],
  });
}
