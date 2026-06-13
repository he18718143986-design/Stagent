import type { SettingDomainEntry } from './types';

export const PLAN_SETTINGS: SettingDomainEntry[] = [
  {
    key: 'plan.requireCompleteness',
    defaultSummary: 'true（硬门开启）',
    effect: '多文件 software/prototype 生成后校验验证阶段、main 装配、测试基础设施；失败则 workflowFailed。',
  },
  {
    key: 'plan.structuralRepair',
    defaultSummary: 'off（仅阻断）',
    effect: 'requireCompleteness 命中后确定性插入缺失验证/测试基础设施阶段（auto）；不修 missing-main-assembly。',
  },
  {
    key: 'autoInsertGlobalArchitectureDecision',
    defaultSummary: 'false',
    effect: '多模块 software 缺全局架构决策时 normalize 插入空壳决策阶段 + SOFT warning。',
  },
];
