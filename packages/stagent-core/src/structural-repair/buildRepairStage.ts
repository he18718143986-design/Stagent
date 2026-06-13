import type { CodeRunnerConfig, Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { STAGE_TOOL_CODE_RUNNER, STAGE_TOOL_LLM_TEXT } from '../workflow/StageToolKinds';
import { VERIFY_OUT_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { STAGENT_REPAIR_MARKER } from './types';
import { mkRepairDescription, uniqueStageId } from './helpers';

export function buildRepairLlmTextStage(opts: {
  wf: WorkflowDefinition;
  idPrefix: string;
  title: string;
  descriptionDetail: string;
  aiTip: string;
  systemPrompt: string;
  writeOutputToFile?: string;
  outputKey: string;
  userInputLabel?: string;
  exposeAssumptions?: boolean;
}): Stage {
  const id = uniqueStageId(opts.wf, opts.idPrefix);
  return {
    id,
    title: `${STAGENT_REPAIR_MARKER} ${opts.title}`,
    description: mkRepairDescription(opts.descriptionDetail),
    aiTip: opts.aiTip,
    tool: STAGE_TOOL_LLM_TEXT,
    toolConfig: {
      type: STAGE_TOOL_LLM_TEXT,
      systemPrompt: opts.systemPrompt,
      ...(opts.writeOutputToFile ? { writeOutputToFile: opts.writeOutputToFile } : {}),
    },
    input: {
      sources: [{ type: 'user-input', label: opts.userInputLabel ?? '测试基础设施约束' }],
      mergeStrategy: 'concat',
    },
    outputs: [{ key: opts.outputKey, format: 'text' }],
    pauseAfter: false,
    exposeAssumptions: opts.exposeAssumptions ?? true,
  };
}

export function buildRepairCodeRunnerStage(opts: {
  wf: WorkflowDefinition;
  idPrefix: string;
  title: string;
  descriptionDetail: string;
  command: string;
  outputKey?: string;
}): Stage {
  const id = uniqueStageId(opts.wf, opts.idPrefix);
  const toolConfig: CodeRunnerConfig = {
    type: STAGE_TOOL_CODE_RUNNER,
    command: opts.command,
    captureOutput: true,
  };
  return {
    id,
    title: `${STAGENT_REPAIR_MARKER} ${opts.title}`,
    description: mkRepairDescription(opts.descriptionDetail),
    tool: STAGE_TOOL_CODE_RUNNER,
    toolConfig,
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: opts.outputKey ?? VERIFY_OUT_OUTPUT_KEY, format: 'text' }],
    pauseAfter: false,
  };
}
