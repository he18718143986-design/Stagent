export type SettingsProfileId = 'default' | 'strict' | 'relaxed' | 'minimal';

export interface SettingsProfileSpec {
  id: SettingsProfileId;
  label: string;
  description: string;
  overrides: Record<string, unknown>;
}

export const SETTINGS_PROFILES: SettingsProfileSpec[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'package.json 默认值；plan 完整性 hard、TDD/debug warn/hard 混合。',
    overrides: {},
  },
  {
    id: 'strict',
    label: 'Strict',
    description: '全部 hard 门禁：TDD、debug 反馈回路、SDK 契约、Rule20、计划完整性 + 结构修复。',
    overrides: {
      'tdd.redGreenGate': 'hard',
      'debug.requireFeedbackLoop': 'hard',
      'plan.requireCompleteness': true,
      'plan.structuralRepair': 'auto',
      'execution.sdkPathContractLint': 'hard',
      'execution.testRunPreflight': true,
      'execution.splitTestRunBundledCommands': true,
      'execution.testRunFailurePlaybook': true,
      'enableRuntimeRule20Verify': true,
      'enableDecisionContentLint': true,
      'hitl.pauseContractNodes': true,
      'toIssues.horizontalLayeringFail': true,
      'experience.injectOnGenerate': true,
      'staticAnalysis.enabled': true,
    },
  },
  {
    id: 'relaxed',
    label: 'Relaxed',
    description: 'warn 为主：保留计划完整性与 Rule20，TDD/debug/SDK 契约仅告警不阻断。',
    overrides: {
      'tdd.redGreenGate': 'warn',
      'debug.requireFeedbackLoop': 'warn',
      'plan.requireCompleteness': true,
      'plan.structuralRepair': 'off',
      'execution.sdkPathContractLint': 'warn',
      'execution.testRunPreflight': true,
      'execution.splitTestRunBundledCommands': true,
      'execution.testRunFailurePlaybook': true,
      'enableRuntimeRule20Verify': true,
      'enableDecisionContentLint': true,
      'hitl.pauseContractNodes': true,
      'toIssues.horizontalLayeringFail': false,
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: '关闭非核心门禁：无计划完整性/TDD/debug/SDK lint/经验库；保留 LLM 与基础 HITL。',
    overrides: {
      'tdd.redGreenGate': 'off',
      'debug.requireFeedbackLoop': 'off',
      'plan.requireCompleteness': false,
      'plan.structuralRepair': 'off',
      'execution.sdkPathContractLint': 'off',
      'execution.testRunPreflight': false,
      'execution.testRunFailurePlaybook': false,
      'execution.splitTestRunBundledCommands': false,
      'enableRuntimeRule20Verify': false,
      'enableDecisionContentLint': false,
      'hitl.pauseContractNodes': false,
      'memory.enableExperienceStore': false,
      'experience.injectOnGenerate': false,
      'staticAnalysis.enabled': false,
      'toIssues.horizontalLayeringFail': false,
    },
  },
];

export function getSettingsProfile(profileId: SettingsProfileId): SettingsProfileSpec {
  const found = SETTINGS_PROFILES.find((p) => p.id === profileId);
  if (!found) {
    return SETTINGS_PROFILES[0];
  }
  return found;
}

export function getSettingsProfileOverrides(profileId: SettingsProfileId): Record<string, unknown> {
  return { ...getSettingsProfile(profileId).overrides };
}
