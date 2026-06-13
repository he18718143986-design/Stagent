import type { SettingDomainEntry } from './types';

export const CORE_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'settingsProfile',
    defaultSummary: 'default',
    effect: '预设 Profile 标识（文档/校验参考；显式键值仍优先于 Profile 建议）。',
  },
  {
    key: 'glossary.enabled',
    defaultSummary: 'true',
    effect: '活 StagentPaths.CONTEXT_MD_FILENAME（`.stagent/` 下）词汇表 + ADR 留存。',
  },
  {
    key: 'architecture.depthScoring',
    defaultSummary: 'false',
    effect: '深模块评分接入质量分（浅模块降分）。',
  },
  {
    key: 'feedback.formUrl',
    defaultSummary: '""',
    effect: '工作流完成后反馈表单链接；空则不打断。',
  },
  {
    key: 'feedback.cooldownDays',
    defaultSummary: '7',
    effect: '两次反馈提示最小间隔天数。',
  },
];
