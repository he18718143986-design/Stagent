import { planCompletenessMsg } from '../l10n/lintMsg';
import { isDecideStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { writeOutputToFileOf } from './planCompletenessStageAccess';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

export type ServerFramework = 'express' | 'nestjs' | 'unknown';

const NESTJS_TEST_MARKERS: RegExp[] = [
  /@nestjs\/testing/,
  /@nestjs\/common/,
  /@nestjs\/core/,
  /\bINestApplication\b/,
  /\bNestFactory\b/,
  /\bTestingModule\b/,
  /\bAppModule\b.*nestjs/i,
];

const EXPRESS_DECISION_MARKERS: RegExp[] = [
  /\bNode\.js\s*\+\s*Express\b/i,
  /\bExpress\b.*\bSocket\.?io\b/i,
  /后端.*Express/i,
  /default Node\.js \+ Express/i,
];

const NESTJS_DECISION_MARKERS: RegExp[] = [
  /\bNestJS\b/i,
  /@nestjs\//,
  /\bINestApplication\b/,
];

function textOfStage(stage: Stage): string {
  const prompt = (stage.toolConfig as { systemPrompt?: string }).systemPrompt ?? '';
  const desc = stage.description ?? '';
  return `${prompt}\n${desc}`;
}

/** 从决策阶段与 server impl prompt 推断后端框架。 */
export function inferServerFramework(wf: WorkflowDefinition): ServerFramework {
  let expressScore = 0;
  let nestScore = 0;

  for (const stage of wf.stages) {
    const text = textOfStage(stage);
    if (isDecideStageId(stage.id) || stage.isDecisionStage) {
      if (EXPRESS_DECISION_MARKERS.some((re) => re.test(text))) {
        expressScore += 2;
      }
      if (NESTJS_DECISION_MARKERS.some((re) => re.test(text))) {
        nestScore += 2;
      }
    }
    const out = writeOutputToFileOf(stage)?.replace(/\\/g, '/').toLowerCase() ?? '';
    if (out.startsWith('server/') || out.includes('/server/')) {
      if (/express/i.test(text)) {
        expressScore += 1;
      }
      if (/@nestjs|nestjs/i.test(text)) {
        nestScore += 1;
      }
    }
  }

  if (expressScore > nestScore && expressScore > 0) {
    return 'express';
  }
  if (nestScore > expressScore && nestScore > 0) {
    return 'nestjs';
  }
  return 'unknown';
}

function nestJsMarkersIn(text: string): boolean {
  return NESTJS_TEST_MARKERS.some((re) => re.test(text));
}

function isServerTestWriteStage(stage: Stage): boolean {
  if (!isTestWriteStageId(stage.id) || !isLlmTextTool(stage.tool)) {
    return false;
  }
  const out = writeOutputToFileOf(stage)?.replace(/\\/g, '/').toLowerCase() ?? '';
  return out.startsWith('server/') || out.includes('/server/') || /server.*test|__tests__.*server/i.test(out);
}

export function lintTestStackNestJsMismatch(
  wf: WorkflowDefinition,
  framework: ServerFramework = inferServerFramework(wf),
): PlanCompletenessIssue[] {
  if (framework !== 'express') {
    return [];
  }
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages) {
    if (!isServerTestWriteStage(stage)) {
      continue;
    }
    const prompt = (stage.toolConfig as { systemPrompt?: string }).systemPrompt ?? '';
    if (!nestJsMarkersIn(prompt)) {
      continue;
    }
    const target = writeOutputToFileOf(stage) ?? stage.id;
    issues.push({
      type: 'test-stack-nestjs-mismatch',
      message: planCompletenessMsg('test-stack-nestjs-mismatch', target, stage.id),
    });
  }
  return issues;
}
