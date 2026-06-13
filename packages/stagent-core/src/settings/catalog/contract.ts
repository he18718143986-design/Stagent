import type { SettingDomainEntry } from './types';

export const CONTRACT_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'contract.infraChainV2',
    defaultSummary: 'true',
    effect: 'InfraChain SSOT：统一 venv/verify/conftest 的 lint、inject、audit 判定。',
  },
  {
    key: 'contract.planPreflightV2',
    defaultSummary: 'false',
    effect: '生成期 Plan Preflight 编排：raw 计划 lint → disk-bootstrap → final lint。',
  },
  {
    key: 'contract.commitments',
    defaultSummary: 'false',
    effect: 'approveDecision 后提取 CommitmentSnapshot 机读承诺。',
  },
  {
    key: 'contract.commitmentsLlmFallback',
    defaultSummary: 'false',
    effect: 'Commitment 规则解析有缺口时可选 LLM 补全。',
  },
  {
    key: 'contract.runtimePreflightV2',
    defaultSummary: 'false',
    effect: '运行期三层 Runtime Preflight 统一路由（plan/decision/disk）。',
  },
  {
    key: 'contract.boundExecution',
    defaultSummary: 'false',
    effect: 'impl 窄写入 gate + deterministic 阶段跳过多余 HITL。',
  },
  {
    key: 'contract.diagnosticRouter',
    defaultSummary: 'false',
    effect: '失败诊断统一路由 config/symbol/assertion/semantic。',
  },
  {
    key: 'contract.skeletonCompiler',
    defaultSummary: 'false（greenfield Python multi-module 默认 true，M5）',
    effect:
      'greenfield_full + Python multi-module：用 plan-skeleton 展开标准 DAG，跳过全量 LLM JSON 生成；一次 LLM 语义填充 stagePrompts。',
  },
];
