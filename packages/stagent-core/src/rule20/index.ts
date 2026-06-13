export type {
  VerifyIssue,
  VerifyResult,
  VerifyRule20Options,
  ViolationType,
  WarningType,
} from './types';

export {
  userHintsMultiModuleOrFullProject,
  hasGlobalArchitectureDecisionStage,
  shouldWarnSoftwareMissingGlobalArchitectureDecision,
} from './architecture';

export { verifyRule20 } from './verify';
