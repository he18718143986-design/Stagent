import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';
import type { StructuralRepairPathConfidence } from '../types';
import { buildRepairLlmTextStage } from '../buildRepairStage';
import { joinConfigPath } from '../helpers';

export function buildJestConfigStage(
  wf: WorkflowDefinition,
  dir: string,
  pathConfidence: StructuralRepairPathConfidence,
  expo: boolean,
): Stage {
  const writePath =
    pathConfidence === 'high' ? joinConfigPath(dir, 'jest.config.js') : undefined;
  const presetHint = expo
    ? "preset: 'jest-expo'（或等价 jest-expo 配置）"
    : 'TypeScript 项目可用 ts-jest / node 环境';
  return buildRepairLlmTextStage({
    wf,
    idPrefix: 'stage_impl_stagent_jest_config',
    title: 'Jest 配置',
    descriptionDetail: '自动插入：在 test_run 之前生成 jest.config',
    aiTip: '引擎插入。请产出可运行的 jest.config.js；路径须与后续 test_run 的工作目录一致。',
    systemPrompt: `仅输出单个 jest.config.js 文件正文（无 markdown 围栏）。${presetHint}。`,
    writeOutputToFile: writePath,
    outputKey: 'jestConfig',
  });
}

export function buildBabelConfigStage(
  wf: WorkflowDefinition,
  dir: string,
  pathConfidence: StructuralRepairPathConfidence,
): Stage {
  const writePath =
    pathConfidence === 'high' ? joinConfigPath(dir, 'babel.config.js') : undefined;
  return buildRepairLlmTextStage({
    wf,
    idPrefix: 'stage_impl_stagent_babel_config',
    title: 'Babel 配置',
    descriptionDetail: '自动插入：Expo/RN 栈在 test_run 之前生成 babel.config',
    aiTip: '引擎插入。请产出 babel-preset-expo 等可运行的 babel.config.js。',
    systemPrompt:
      '仅输出单个 babel.config.js 文件正文（无 markdown 围栏），使用 babel-preset-expo 或项目匹配的 Expo preset。',
    writeOutputToFile: writePath,
    outputKey: 'babelConfig',
  });
}
