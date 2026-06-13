import { uiMsg } from './uiStrings';

export function confidenceReasonMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.confidence.reason.${key}`;
  return uiMsg(full, ...args);
}

export function qualityIssueMsg(code: string, ...args: Array<string | number>): string {
  const camel = code.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return uiMsg(`stagent.quality.issue.${camel}`, ...args);
}

export function debugGateMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.gate.debug.${key}`;
  return uiMsg(full, ...args);
}
