import type { Stage, WorkflowDefinition } from './WorkflowDefinition';

/**
 * M21.4：契约型节点识别 + HITL 暂停升级。
 *
 * 背景：reader / fetcher / analyzer / writer / main 这类「靠键名/容器类型互相拼装」的数据管道核心
 * 阶段，置信度常停在 0.7（medium），但 pauseThreshold=0.4 时全部自动放行，跨模块契约错位无人复审。
 *
 * 本模块提供纯函数：判断某 stage 是否为「契约节点」（被 ≥2 个下游引用，或数据管道核心 impl），
 * 供 AdaptiveHITLPolicy.shouldPauseAfterStage 在 medium 置信度时升级为暂停。
 */

/** 与 package.json `stagent.hitl.contractNodePauseThreshold` 默认值一致 */
export const DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD = 0.75;

/** 数据管道核心语义（承载跨模块契约的 impl 节点） */
export const DATA_PIPELINE_CORE_HINT =
  /(reader|fetcher|parser|loader|analyzer|analyser|aggregator|transformer|writer|exporter|comparator|differ|pipeline|client|service|repository|mapper|merger|matcher|calculator|processor|controller|handler|main|monitor)/i;

/** 非契约型 artifact（依赖/配置/样例/文档/脚手架），即便位于 stage_impl_* 也不算契约节点 */
const NON_CONTRACT_ARTIFACT_HINT =
  /(requirements|config_?ya?ml|config_?json|mock_data|create_sample|sample_data|sample|readme|gitignore|dotenv|^env$|package_?json|tsconfig|setup|bootstrap)/i;

const CODE_FILE_EXT = /\.(py|ts|tsx|js|jsx|mjs|cjs|go|rb|java|rs|kt|php|cs)$/i;

/** stage 输出被多少个下游 stage 通过 stage-output 引用 */
export function countDownstreamStageOutputRefs(
  workflow: WorkflowDefinition,
  stageId: string,
): number {
  let count = 0;
  for (const st of workflow.stages ?? []) {
    if (st.id === stageId) {
      continue;
    }
    const refs = st.input?.sources ?? [];
    if (refs.some((s) => s.type === 'stage-output' && s.stageId === stageId)) {
      count += 1;
    }
  }
  return count;
}

/**
 * 数据契约源：定义「权威标识列表 / API 响应 schema」的阶段（create_sample / mock_data / schema / fixture / seed）。
 * 它们虽不是数据管道核心 impl，却是跨模块契约（ASIN 源、字段 schema）的**源头**——M27.2 起也算契约节点，
 * 在 medium 置信度时升级人工复审（修补 M21.4「漏掉最该保护的两个节点」的缺陷）。
 */
const DATA_CONTRACT_SOURCE_HINT =
  /(create_sample|sample_data|(^|_)sample$|mock_?data|mock_?response|fixture|seed_data|(^|_)schema(_|$)|data_schema)/i;

export function isDataContractSourceStage(stage: Stage): boolean {
  if (!/^stage_impl_/.test(stage.id)) {
    return false;
  }
  const semantic = stage.id.replace(/^stage_impl_(prototype_)?/, '');
  return DATA_CONTRACT_SOURCE_HINT.test(semantic);
}

/** 是否为数据管道核心 impl（reader/fetcher/analyzer/writer/main…，且落盘为代码文件、非配置/样例类） */
export function isDataPipelineCoreStage(stage: Stage): boolean {
  if (!/^stage_impl_/.test(stage.id)) {
    return false;
  }
  const semantic = stage.id.replace(/^stage_impl_(prototype_)?/, '');
  if (NON_CONTRACT_ARTIFACT_HINT.test(semantic)) {
    return false;
  }
  const tc = stage.toolConfig as { writeOutputToFile?: string };
  const file = (tc?.writeOutputToFile ?? '').trim();
  // 若声明了落盘文件，仅当其为代码文件时才视为契约节点（排除 .yaml/.json/.txt/.md 等）
  if (file && !CODE_FILE_EXT.test(file)) {
    return false;
  }
  return DATA_PIPELINE_CORE_HINT.test(semantic);
}

/**
 * 契约节点 = 被 ≥2 个下游引用（数据被多方消费）或属于数据管道核心 impl。
 * 这两类节点的契约错位（键名/容器类型漂移）影响面最大，最值得 HITL 复审。
 */
export function isContractNode(workflow: WorkflowDefinition, stage: Stage): boolean {
  if (countDownstreamStageOutputRefs(workflow, stage.id) >= 2) {
    return true;
  }
  // M27.2：数据契约源（create_sample / mock_data / schema 等）即便依赖经 prompt 文字表达、
  // 无 stage-output 边，也纳入契约节点——正是它们承载 ASIN 源与字段 schema。
  if (isDataContractSourceStage(stage)) {
    return true;
  }
  return isDataPipelineCoreStage(stage);
}

export interface ContractNodePauseInput {
  isContractNode: boolean;
  confidenceScore: number;
  /** 低于该阈值（且为契约节点）即升级暂停；默认 0.75（即非 high 置信度都暂停） */
  contractNodePauseThreshold: number;
  /** 总开关；false 时退回原有 confidencePauseThreshold 行为 */
  enabled: boolean;
}

/** 契约节点 + 置信度未达 contractNodePauseThreshold（即非 high）→ 升级为暂停 */
export function shouldEscalateContractNodePause(input: ContractNodePauseInput): boolean {
  if (!input.enabled || !input.isContractNode) {
    return false;
  }
  return input.confidenceScore < input.contractNodePauseThreshold;
}
