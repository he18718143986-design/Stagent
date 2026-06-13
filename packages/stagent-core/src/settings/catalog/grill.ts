import type { SettingDomainEntry } from './types';

export const GRILL_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'grill.adaptiveMode',
    defaultSummary: 'false',
    effect: '强制决策阶段「一次一问」adaptive grill（覆盖 autoOnDecisionStages 启发式）。',
  },
  {
    key: 'grill.autoOnDecisionStages',
    defaultSummary: 'true',
    effect: '决策阶段 + questionBefore 时对契约节点/高复杂度任务自动启用 adaptive grill。',
  },
];
