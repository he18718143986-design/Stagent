import type { SettingDomainEntry } from './types';

export const TDD_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'tdd.redGreenGate',
    defaultSummary: 'hard',
    effect: 'impl 前要求配对测试 RED；hard 真正跑测试，GREEN 则阻断（默认）。',
  },
  {
    key: 'enableRuntimeRule20Verify',
    defaultSummary: 'true',
    effect: 'generateWorkflow 跑 verifyRule20；violations 阻断生成。',
  },
  {
    key: 'toIssues.horizontalLayeringFail',
    defaultSummary: 'false',
    effect: 'to-issues horizontal-tdd 观测升 fail（Phase 4 可选）。',
  },
];
