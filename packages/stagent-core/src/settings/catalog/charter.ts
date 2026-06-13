import type { SettingDomainEntry } from './types';

export const CHARTER_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'charter.enabled',
    defaultSummary: 'true',
    effect: '为 true 时从工作区加载 Charter 并将 avoid/constraint 全量注入 llm-text systemPrompt。',
  },
  {
    key: 'charter.autoAnswerMode',
    defaultSummary: 'off',
    effect:
      'off=仅背景参考；suggest=代答须人确认。auto-with-escalation=非 ADR 静默预填（Gate 1 calibration 通过后灰度；afk 预设）。escalated 三闸门不可绕过。',
  },
  {
    key: 'charter.path',
    defaultSummary: 'docs/agents/charter.md',
    effect: 'Charter markdown 相对工作区路径（Layer 5 持久化）。',
  },
];
