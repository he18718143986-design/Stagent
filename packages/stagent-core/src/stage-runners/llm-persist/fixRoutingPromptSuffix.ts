import { buildBehaviorSpecFixHints } from '../../commitment/behaviorSpec';
import { planDiagnosticRouteFromStageError } from '../../diagnostic-router/DiagnosticRouter';
import { buildForwardSliceImportFixHints } from '../../python-contract/ForwardSliceImportLint';
import type { StageRuntime } from '../../WorkflowDefinition';
import { CODE_RUNNER_EXIT_OUTPUT_KEY } from '../../WorkflowOutputKeys';
import { readTestRunFailureExcerpt } from './testImportBridgePromptSuffix';

function signalsNoneResultFixHints(
  diagnostic: string,
  semantic: string | undefined,
  stageRuntimes: StageRuntime[] | undefined,
): string[] {
  if (semantic !== 'signals') {
    return [];
  }
  if (!/generate_(bear|bull)_signal|SignalGenerator/i.test(diagnostic)) {
    return [];
  }
  if (!/is not None|AssertionError.*None|assert None/i.test(diagnostic)) {
    return [];
  }
  const fromSpec = buildBehaviorSpecFixHints(stageRuntimes ?? [], semantic);
  if (fromSpec.length > 0) {
    return fromSpec;
  }
  return [
    '- signals：`generate_*_signal` 返回 None → 某 AND 子条件未满足；对照 failing test 的 fixture 数值逐条对齐 impl（禁止改 test）。',
    '- bear CCI：prev >= cci_cross_band 且 last < -cci_cross_band；bull：prev <= -cci_cross_band 且 last > cci_cross_band。',
    '- bull 需 volume_spike；bear 的 volume 子条件在 AND 链中可忽略。',
    '- index_above_ma20=True：bear 要 close < MA20，bull 要 close > MA20；1min/3min 趋势与 direction 一致。',
  ];
}

export function buildFixRoutingPromptSuffix(params: {
  testRunRuntime: StageRuntime | undefined;
  contractExports?: string[];
  additionalTargets?: string[];
  semantic?: string;
  stageRuntimes?: StageRuntime[];
  sliceOrder?: string[];
}): string {
  const { testRunRuntime, contractExports, additionalTargets, semantic, stageRuntimes, sliceOrder } =
    params;
  const diagnostic = readTestRunFailureExcerpt(testRunRuntime) ?? '';
  const stdout = diagnostic;
  const stderr = '';
  const exitCode = testRunRuntime?.outputs?.[CODE_RUNNER_EXIT_OUTPUT_KEY];
  const route = planDiagnosticRouteFromStageError({
    stageId: testRunRuntime?.stageId ?? '',
    errorType: 'tool-execution-failed',
    message: `exitCode=${exitCode ?? 'unknown'}`,
    stdout,
    stderr,
  });

  const lines = [
    '',
    '【R3b 修复路由】',
    `- 诊断分类：${route.category} / ${route.action}`,
  ];
  if (contractExports?.length) {
    lines.push(`- 契约 exports（禁止改名）：${contractExports.join(', ')}`);
    lines.push(
      '- 模块顶层仅可 export 上述符号；辅助 dataclass（OrderResult/Account/OrderRequest 等）须嵌套在类内或 `_` 前缀，禁止模块级公开。',
    );
  }

  if (/ModuleNotFound|No module named/i.test(`${stdout}\n${stderr}`)) {
    lines.push(
      '- 依赖缺失：在 requirements.txt 段追加已声明依赖（pytest/numpy/pandas 或 decisionArtifacts.dependencies），禁止静默 import 未声明第三方包（如 talib）。',
    );
  } else if (/import|cannot import name|symbol/i.test(`${stdout}\n${stderr}`)) {
    lines.push(
      '- 符号/import 漂移：只改回契约 exports 对应实现；禁止发明新符号或改 test import 名。',
    );
  } else {
    lines.push('- 断言失败：对齐 impl 与 test 行为，不改 export 名与公开 API。');
  }

  for (const hint of signalsNoneResultFixHints(diagnostic, semantic, stageRuntimes)) {
    lines.push(hint);
  }

  if (sliceOrder?.length) {
    for (const hint of buildForwardSliceImportFixHints({
      diagnostic,
      currentSemantic: semantic,
      sliceOrder,
    })) {
      lines.push(hint);
    }
  }

  if (additionalTargets?.length) {
    lines.push(
      '- 多文件输出格式（必须）：',
      `--- file: <主 impl 路径> ---`,
      '<impl 全文>',
    );
    for (const t of additionalTargets) {
      lines.push(`--- file: ${t} ---`, `<${t} 全文>`);
    }
  }

  if (diagnostic) {
    lines.push('', '--- pytest 失败输出（摘要）---', diagnostic);
  }

  return lines.join('\n');
}
