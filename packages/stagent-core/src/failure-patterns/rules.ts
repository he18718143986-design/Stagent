import type { ErrorType } from '../WorkflowDefinition';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
} from '../errors/stageErrorBuilders';
import type { ActionablePatternKind } from './types';

export interface ErrorBucketRule {
  match: (errorType: ErrorType, prefix: string) => boolean;
  kind: ActionablePatternKind;
  recommendation: string;
}

export const ERROR_BUCKET_RULES: ErrorBucketRule[] = [
  {
    match: (errorType) => errorType === ERROR_TYPE_CODE_RUNNER_TIMEOUT,
    kind: 'code-runner-timeout-cluster',
    recommendation:
      '检查是否为 npm/pip install（引擎默认 300s 且沙箱自动放行网络）；否则缩短命令、拆分验证阶段，或仅在确需时显式提高 timeout',
  },
  {
    match: (errorType, prefix) =>
      errorType === ERROR_TYPE_TOOL_EXECUTION_FAILED && prefix.includes('test_run'),
    kind: 'test-run-import-missing-artifact',
    recommendation:
      'stage_test_run 命令 import 了未落盘模块或脚本路径不在 writeOutputToFile 登记内；' +
      '生成器须遵守 ARTIFACT_REGISTRY：仅有 config.yaml 时禁止 from config import；' +
      '对齐 reader.py/fetcher.py 等 artifact 后再写 python -c',
  },
  {
    match: (_errorType, prefix) => prefix.includes('decide'),
    kind: 'decision-retry-heavy',
    recommendation: '强化决策阶段 Rule 20 四节约束；检查 enableDecisionContentLint',
  },
  {
    match: (errorType) =>
      errorType === ERROR_TYPE_LLM_INVALID_OUTPUT || errorType === ERROR_TYPE_TOOL_EXECUTION_FAILED,
    kind: 'stage-impl-failure',
    recommendation: '检查 impl 输出是否空洞；启用 OutputQualityScorer 观测',
  },
];

export const DEFAULT_ERROR_BUCKET_RULE: ErrorBucketRule = {
  match: () => true,
  kind: 'stage-impl-failure',
  recommendation: '检查该阶段 systemPrompt 与输入上下文是否完整',
};
