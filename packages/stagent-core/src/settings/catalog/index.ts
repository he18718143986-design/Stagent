import type { SettingsDomain, SettingDomainEntry } from './types';
import { PLAN_SETTINGS } from './plan';
import { EXECUTION_SETTINGS } from './execution';
import { GRILL_SETTINGS } from './grill';
import { CHARTER_SETTINGS } from './charter';
import { TDD_SETTINGS } from './tdd';
import { MEMORY_SETTINGS } from './memory';
import { HITL_SETTINGS } from './hitl';
import { DEBUG_SETTINGS } from './debug';
import { LLM_SETTINGS } from './llm';
import { CORE_SETTINGS } from './core';
import { CONTRACT_SETTINGS } from './contract';

export type { SettingsDomain, SettingDomainEntry } from './types';

export const SETTINGS_DOMAIN_CATALOG: Record<SettingsDomain, SettingDomainEntry[]> = {
  plan: PLAN_SETTINGS,
  execution: EXECUTION_SETTINGS,
  grill: GRILL_SETTINGS,
  charter: CHARTER_SETTINGS,
  tdd: TDD_SETTINGS,
  memory: MEMORY_SETTINGS,
  hitl: HITL_SETTINGS,
  debug: DEBUG_SETTINGS,
  llm: LLM_SETTINGS,
  core: CORE_SETTINGS,
  contract: CONTRACT_SETTINGS,
};
