import type { SettingDomainEntry } from './types';

export const HITL_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'hitl.pauseContractNodes',
    defaultSummary: 'true',
    effect: '契约节点置信度未达阈值时升级为人工暂停。',
  },
  {
    key: 'hitl.contractNodePauseThreshold',
    defaultSummary: '0.75',
    effect: '契约节点暂停阈值（0–1）。',
  },
  {
    key: 'confidence.pauseThreshold',
    defaultSummary: '0.4',
    effect: '置信度低于此值强制暂停（AdaptiveHITL）。',
  },
  {
    key: 'enableDecisionContentLint',
    defaultSummary: 'true',
    effect: 'approveDecision 时 DecisionRecord 结构校验（I-17~I-19）。',
  },
  {
    key: 'injectApprovedDecisionContext',
    defaultSummary: 'true',
    effect: '非决策 llm-text 阶段注入已批准 decision 摘要/全文。',
  },
  {
    key: 'globalDecisionInjectMode',
    defaultSummary: 'summary',
    effect: '全局决策注入模式：summary | full。',
  },
];
