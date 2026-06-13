import type { SettingDomainEntry } from './types';

export const MEMORY_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'memory.enableExperienceStore',
    defaultSummary: 'true',
    effect: '持久化执行经验到 StagentPaths.EXPERIENCES_FILENAME（`.stagent/` 下）。',
  },
  {
    key: 'memory.maxExperienceEntries',
    defaultSummary: '500',
    effect: '经验库 FIFO 上限。',
  },
  {
    key: 'experience.injectOnGenerate',
    defaultSummary: 'false（灰度）',
    effect: 'generateWorkflow 注入经验 few-shot；依赖 enableExperienceStore。',
  },
  {
    key: 'codebaseContext.enabled',
    defaultSummary: 'true',
    effect: '生成工作流时注入代码库快照。',
  },
  {
    key: 'codebaseContext.maxTokens',
    defaultSummary: '4000',
    effect: '代码库快照 token 上限。',
  },
  {
    key: 'promptVersions.enabled',
    defaultSummary: 'true',
    effect: '从 StagentPaths.PROMPT_VERSIONS_FILENAME（`.stagent/` 下）读取可变 prompt 槽位。',
  },
];
