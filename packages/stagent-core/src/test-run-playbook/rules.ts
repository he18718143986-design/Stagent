import type { TestRunFailurePlaybook, ClassifyTestRunFailureInput } from './types';

export interface TestRunFailureRule {
  code: string;
  match: (blob: string, input: ClassifyTestRunFailureInput) => boolean;
  build: (blob: string, input: ClassifyTestRunFailureInput) => TestRunFailurePlaybook;
}

export function outputBlob(stdout: string, stderr: string): string {
  return `${stdout}\n${stderr}`.slice(-12000);
}
