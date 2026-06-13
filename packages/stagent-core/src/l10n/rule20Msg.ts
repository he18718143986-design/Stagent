import type { VerifyIssue } from '../rule20/types';
import { lintMsg } from './lintMsg';

export function rule20TypeToKey(type: string): string {
  const camel = type.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return `stagent.rule20.${camel}`;
}

function typeToCamelSlug(type: string): string {
  if (!type.includes('-')) {
    return type;
  }
  return type.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function rule20LabelKey(type: string): string {
  return `stagent.rule20.label.${typeToCamelSlug(type)}`;
}

export function contractLabelKey(kind: string): string {
  return `stagent.contract.label.${typeToCamelSlug(kind)}`;
}

export function rule20Msg(type: VerifyIssue['type'], ...args: Array<string | number>): string {
  return lintMsg(rule20TypeToKey(type), ...args);
}

export function rule20DisplayLabel(type: string): string {
  return lintMsg(rule20LabelKey(type));
}

/** Strip trailing (warning) / （warning） when promoting soft issues to violations. */
export function stripRule20WarningSuffix(message: string): string {
  return message.replace(/\s*[(（]warning[）)]\s*[。.]?$/i, '').trim();
}
