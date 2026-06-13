import { formatPlanIncompleteBlockReason } from '../lint/WorkflowWarningTokens';
import { planCompletenessMsg } from '../l10n/lintMsg';
import { pushTypedMessageIssue } from '../lint/CodedLintIssue';
import { hasExecutableVerificationStage } from './stageChecks';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { codeImplStages, hasMainAssemblyStage } from './mainAssemblyChecks';
import {
  hasTestInfrastructureBeforeFirstTestRun,
  lintTestInfraPathAlignment,
  planRequiresTestInfrastructure,
  planSignalsExpoStack,
} from './testInfraChecks';
import { isSoftwareOrPrototypeTaskType } from '../workflow/TaskType';
import { detectSelfHealGaps } from './selfHealGapDetector';
import { lintWorkflowMultiFilePromptMismatches } from './multiFileImplChecks';
import { lintTestStackNestJsMismatch } from './testStackChecks';
import { lintWorkflowUpstreamFixRouting } from './upstreamFixPlanChecks';
import { lintTestWriteImportPathsInPlan } from './testWriteImportChecks';
import { lintPythonTestInfraInPlan } from './pythonTestInfraChecks';
import { lintMissingTestRunPairs, lintSoftwareRequiresVerification } from './tddChainChecks';
import { lintExpressIncompatibleModuleLayout, lintMultiModuleSliceCoverage } from './multiModuleLayoutChecks';
import { lintModuleContractPlan } from './moduleContractChecks';
import { lintSkeletonSemanticPlaceholder } from './semanticFillChecks';
import { lintTemplateStageCap } from '../path-router/templateStageCap';
import { isWorkflowTemplate } from '../path-router/WorkflowTemplateTypes';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

export function lintPlanCompleteness(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!isSoftwareOrPrototypeTaskType(wf.meta?.taskType)) {
    const capMsg = lintTemplateStageCap(wf);
    if (capMsg) {
      return [{ type: 'template-stage-cap-exceeded', message: planCompletenessMsg('template-stage-cap-exceeded', capMsg) }];
    }
    return [];
  }
  const codeImpls = codeImplStages(wf);
  const issues: PlanCompletenessIssue[] = [];
  const isExpressPath = isWorkflowTemplate(wf.meta?.workflowTemplate) && wf.meta.workflowTemplate === 'express';
  const capMsg = lintTemplateStageCap(wf);
  if (capMsg) {
    pushTypedMessageIssue(issues, 'template-stage-cap-exceeded', planCompletenessMsg('template-stage-cap-exceeded', capMsg));
  }
  const softwareVerify = lintSoftwareRequiresVerification(wf);
  if (softwareVerify) {
    pushTypedMessageIssue(issues, softwareVerify.type, softwareVerify.message);
  }
  for (const pair of lintMissingTestRunPairs(wf)) {
    pushTypedMessageIssue(issues, pair.type, pair.message);
  }
  if (codeImpls.length >= 2) {
    if (!hasExecutableVerificationStage(wf)) {
      pushTypedMessageIssue(issues, 'missing-verification-stage', planCompletenessMsg('missing-verification-stage'));
    }
    if (codeImpls.length >= 3 && !hasMainAssemblyStage(wf) && !isExpressPath) {
      pushTypedMessageIssue(issues, 'missing-main-assembly', planCompletenessMsg('missing-main-assembly'));
    }
  }
  if (planRequiresTestInfrastructure(wf) && !hasTestInfrastructureBeforeFirstTestRun(wf)) {
    const expo = planSignalsExpoStack(wf);
    pushTypedMessageIssue(
      issues,
      'missing-test-infrastructure',
      expo
        ? planCompletenessMsg('missing-test-infrastructure', 'expo')
        : planCompletenessMsg('missing-test-infrastructure'),
    );
  } else if (planRequiresTestInfrastructure(wf)) {
    const align = lintTestInfraPathAlignment(wf);
    if (align) {
      pushTypedMessageIssue(issues, align.type, align.message);
    }
  }
  const selfHealGaps = detectSelfHealGaps(wf);
  if (selfHealGaps.length > 0) {
    pushTypedMessageIssue(
      issues,
      'missing-self-heal-chain',
      planCompletenessMsg('missing-self-heal-chain', selfHealGaps.join('；')),
    );
  }
  for (const mf of lintWorkflowMultiFilePromptMismatches(wf.stages)) {
    pushTypedMessageIssue(issues, mf.type, mf.message);
  }
  for (const stack of lintTestStackNestJsMismatch(wf)) {
    pushTypedMessageIssue(issues, stack.type, stack.message);
  }
  for (const route of lintWorkflowUpstreamFixRouting(wf)) {
    pushTypedMessageIssue(issues, route.type, route.message);
  }
  for (const tw of lintTestWriteImportPathsInPlan(wf)) {
    pushTypedMessageIssue(issues, tw.type, tw.message);
  }
  for (const py of lintPythonTestInfraInPlan(wf)) {
    pushTypedMessageIssue(issues, py.type, py.message);
  }
  const expressLayout = lintExpressIncompatibleModuleLayout(wf);
  if (expressLayout) {
    pushTypedMessageIssue(issues, expressLayout.type, expressLayout.message);
  }
  const sliceCoverage = lintMultiModuleSliceCoverage(wf);
  if (sliceCoverage) {
    pushTypedMessageIssue(issues, sliceCoverage.type, sliceCoverage.message);
  }
  for (const mc of lintModuleContractPlan(wf)) {
    pushTypedMessageIssue(issues, mc.type, mc.message);
  }
  for (const sf of lintSkeletonSemanticPlaceholder(wf)) {
    pushTypedMessageIssue(issues, sf.type, sf.message);
  }
  return issues;
}

export function formatPlanCompletenessBlockReason(issues: PlanCompletenessIssue[]): string {
  if (issues.length === 0) {
    return 'plan-completeness: ok';
  }
  const body = issues.map((i) => `[${i.type}] ${i.message}`).join('；');
  return formatPlanIncompleteBlockReason(body);
}
