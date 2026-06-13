export interface TestRunFailurePlaybook {
  code: string;
  title: string;
  summary: string;
  steps: string[];
}

export interface ClassifyTestRunFailureInput {
  stageId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}
