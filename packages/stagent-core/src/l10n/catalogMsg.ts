import type { ErrorType } from '../workflow-types/RuntimeTypes';
import { catalogKeySegment } from './keyMaps';
import { uiMsg } from './uiStrings';

function catalogKey(errorType: ErrorType, part: string): string {
  return `stagent.error.catalog.${catalogKeySegment(errorType)}.${part}`;
}

export function catalogMsg(errorType: ErrorType, field: 'title' | 'hint', ...args: Array<string | number>): string {
  return uiMsg(catalogKey(errorType, field), ...args);
}

export function catalogPlaybookSteps(errorType: ErrorType): string[] {
  const steps: string[] = [];
  for (let n = 1; n <= 8; n++) {
    const key = catalogKey(errorType, `playbook.${n}`);
    const text = uiMsg(key);
    if (!text || text === key) {
      break;
    }
    steps.push(text);
  }
  return steps;
}

export function catalogFallbackTitle(): string {
  return uiMsg('stagent.error.catalog.fallback.title');
}
