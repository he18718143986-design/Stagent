import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import {
  DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
  DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES,
  resolveCodebaseContextMaxTokens,
  resolveMemoryMaxExperienceEntries,
} from '../../StagentSettingsDefaults';
import {
  readConfigBooleanDefaultTrue,
  readConfigBooleanStrictTrue,
  readConfigResolved,
} from './readConfigHelpers';

/** vscode `stagent.memory.enableExperienceStore`；默认 true */
export function readMemoryExperienceStoreEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'memory.enableExperienceStore');
}

/** vscode `stagent.memory.maxExperienceEntries` */
export function readMemoryMaxExperienceEntries(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'memory.maxExperienceEntries',
    resolveMemoryMaxExperienceEntries,
    DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES,
  );
}

/** vscode `stagent.codebaseContext.enabled`；默认 true */
export function readCodebaseContextEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'codebaseContext.enabled');
}

/** vscode `stagent.codebaseContext.maxTokens` */
export function readCodebaseContextMaxTokens(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'codebaseContext.maxTokens',
    resolveCodebaseContextMaxTokens,
    DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
  );
}

/** M17.6 灰度：generateWorkflow 注入经验 few-shot；默认 false */
export function readExperienceInjectOnGenerate(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'experience.injectOnGenerate');
}

/** M18.1：`generateWorkflow` 从 PromptVersionManager 读取槽位；默认 true */
export function readPromptVersionsEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'promptVersions.enabled');
}
