import type { PlanCompletenessViolationType } from '../PlanCompletenessGate';
import type { RepairFn } from './types';
import { repairMissingVerificationStage } from './rules/verification-stage';
import { repairMissingTestInfrastructure } from './rules/test-infrastructure';
import { repairMissingSelfHealChain } from './rules/self-heal-chain';
import {
  repairMissingPythonTestLayout,
  repairMissingPythonVenvChain,
} from './rules/python-infra-chain';

export const STRUCTURAL_REPAIR_RULES: Partial<Record<PlanCompletenessViolationType, RepairFn>> = {
  'missing-verification-stage': repairMissingVerificationStage,
  'missing-test-infrastructure': repairMissingTestInfrastructure,
  'missing-self-heal-chain': repairMissingSelfHealChain,
  'missing-python-venv-chain': repairMissingPythonVenvChain,
  'missing-python-test-layout': repairMissingPythonTestLayout,
};
