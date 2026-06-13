import { uiMsg } from './uiStrings';

export function hitlMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.hitl.${key}`;
  return uiMsg(full, ...args);
}
