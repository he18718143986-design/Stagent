export type SettingsDomain =
  | 'plan'
  | 'execution'
  | 'contract'
  | 'grill'
  | 'charter'
  | 'tdd'
  | 'memory'
  | 'hitl'
  | 'debug'
  | 'llm'
  | 'core';

export interface SettingDomainEntry {
  key: string;
  defaultSummary: string;
  effect: string;
}
