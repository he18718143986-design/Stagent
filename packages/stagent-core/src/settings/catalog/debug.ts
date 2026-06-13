import type { SettingDomainEntry } from './types';

export const DEBUG_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'debug.requireFeedbackLoop',
    defaultSummary: 'hard',
    effect: 'debug 反馈回路：hard=生成期 violation + 运行期阻断；warn/off 递减。',
  },
  {
    key: 'debugVerbose',
    defaultSummary: 'false',
    effect: '在 StagentPaths.WF_DEBUG_FILENAME 记录 llm-text 输出长度与预览。',
  },
  {
    key: 'staticAnalysis.enabled',
    defaultSummary: 'false（灰度）',
    effect: '生成后与 stage_impl_* 后运行 StaticAnalysisPipeline（不阻断 workflow）。',
  },
];
