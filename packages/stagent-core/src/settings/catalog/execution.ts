import type { SettingDomainEntry } from './types';

export const EXECUTION_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'execution.testRunPreflight',
    defaultSummary: 'true',
    effect: 'stage_test_run_* 执行前检测磁盘 jest/babel/tsconfig；缺失则 stageError。',
  },
  {
    key: 'execution.splitTestRunBundledCommands',
    defaultSummary: 'true',
    effect: 'normalize 将 npm install && test 拆成独立 deps 阶段 + 纯测试 command。',
  },
  {
    key: 'execution.testRunAutoNpmInstall',
    defaultSummary: 'true',
    effect: 'test_run 前在 effective cwd 检测 package.json；缺 node_modules 时自动 npm install。',
  },
  {
    key: 'execution.writeOutputIntegrity',
    defaultSummary: 'retry',
    effect: 'LLM 输出与落盘 chars 严重不一致时 warn / 自动重试一次（retry）或关闭（off）。',
  },
  {
    key: 'execution.testRunFailurePlaybook',
    defaultSummary: 'true',
    effect: 'test_run 失败时按 stderr 分类输出可读修复 playbook。',
  },
  {
    key: 'execution.sdkPathContractLint',
    defaultSummary: 'hard',
    effect: 'Decision ↔ impl ↔ test SDK/路径契约 lint；hard 在 test_run 前阻断（默认）。',
  },
  {
    key: 'execution.dangerousCommandLint',
    defaultSummary: 'warn',
    effect: '检测 rm -rf /、curl|bash 等危险 command；warn 写入确认页 warnings，hard 阻断生成/运行。',
  },
  {
    key: 'execution.runtimeReplan',
    defaultSummary: 'true',
    effect: 'gate-repair 仍失败时运行时插入 replan stage（P3b）。',
  },
  {
    key: 'python.moduleContractLint',
    defaultSummary: 'warn（AFK 默认 hard）',
    effect: 'test_write 完成后对照 decisionArtifacts.modules 校验 import 符号；hard 在 impl 前阻断。',
  },
  {
    key: 'python.verifyImportsStrict',
    defaultSummary: 'false（AFK 默认 true）',
    effect: 'plan 含 stage_materialize_stub_* 时 verify-python-test-imports 加 --strict（pre-impl 校验项目内模块存在）。',
  },
  {
    key: 'execution.blockDeliveryOnTestFailure',
    defaultSummary: 'software=true；prototype/document/refactor=false',
    effect:
      'test_run 未全绿时阻断 delivery；fix 链耗尽时 fail 工作流（software 默认开启，可显式覆盖）。',
  },
  {
    key: 'dagMaxParallelism',
    defaultSummary: '2',
    effect: 'DAG 每波并行阶段上限；决策/pauseAfter 仍串行。',
  },
  {
    key: 'sandbox.enabled',
    defaultSummary: 'false（实验性）',
    effect:
      'code-runner 沙箱（默认 false）。macOS+sandbox-exec：内核写隔离+可选断网；Linux/Windows：仅 ulimit/代理软约束（非安全边界，子进程可绕过）；macOS 无 sandbox-exec 时同软约束。不可信代码请用外部容器或 macOS 内核沙箱。',
  },
  {
    key: 'maxManualStageRetries',
    defaultSummary: '3',
    effect: '单阶段手动重试上限（不含首轮自动执行）。',
  },
  {
    key: 'generation.maxParseRetries',
    defaultSummary: '2',
    effect: '工作流生成 JSON 解析重试上限（含首次）；截断续接为有界循环且 token 计入预算。',
  },
];
