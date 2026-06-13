import { uiMsg } from './uiStrings';

export function gateMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.gate.${key}`;
  return uiMsg(full, ...args);
}

export function guardMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.guard.${key}`;
  return uiMsg(full, ...args);
}

export function pregenMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.pregen.${key}`;
  return uiMsg(full, ...args);
}

export function writeOutputMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.writeOutput.${key}`;
  return uiMsg(full, ...args);
}

export function generationMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.generation.${key}`;
  return uiMsg(full, ...args);
}

export function stageRunnerMsg(key: string, ...args: Array<string | number>): string {
  const full = key.startsWith('stagent.') ? key : `stagent.stageRunner.${key}`;
  return uiMsg(full, ...args);
}
