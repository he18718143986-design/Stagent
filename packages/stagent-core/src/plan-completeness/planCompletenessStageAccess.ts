import { isImplStageId, semanticNameForPlanCompleteness } from '../workflow/StageIdPatterns';
import {
  codeRunnerCommandOf,
  writeOutputToFileOf,
} from '../workflow/StageToolConfigAccess';
import type { Stage } from '../WorkflowDefinition';
import {
  BABEL_CONFIG_BASENAME,
  JEST_CONFIG_BASENAME,
  TSCONFIG_BASENAME,
} from '../test-infra/constants';
import { applyTestInfraBasename } from '../test-infra/detectTestInfraArtifacts';
import { emptyTestInfraArtifacts } from '../test-infra/artifacts';
import { isTestInfraConfigBasename, relPathBasename } from '../test-infra/basename';
import { isTestInfraStageSemantic } from './PlanCompletenessStageHints';

export { codeRunnerCommandOf, writeOutputToFileOf };
export { relPathBasename } from '../test-infra/basename';

export const TS_JSX_CODE_EXT = /\.(ts|tsx|jsx)$/i;
export const CODE_FILE_EXT = /\.(py|ts|tsx|js|jsx|mjs|cjs|go|rb|java|rs|kt|php|cs)$/i;

export { JEST_CONFIG_BASENAME, BABEL_CONFIG_BASENAME, TSCONFIG_BASENAME };

export function semanticOf(stageId: string): string {
  return semanticNameForPlanCompleteness(stageId);
}

export function isTestInfraConfigFile(filePath: string): boolean {
  const base = relPathBasename(filePath.replace(/\\/g, '/'));
  return isTestInfraConfigBasename(base);
}

export function stageDeclaresTestInfra(stage: Stage): {
  jest: boolean;
  babel: boolean;
  tsconfig: boolean;
} {
  let jest = false;
  let babel = false;
  let tsconfig = false;
  const file = writeOutputToFileOf(stage);
  if (file) {
    const base = relPathBasename(file.replace(/\\/g, '/'));
    const fromFile = applyTestInfraBasename(emptyTestInfraArtifacts(), base);
    jest = fromFile.jest;
    babel = fromFile.babel;
    tsconfig = fromFile.tsconfig;
  }
  if (isImplStageId(stage.id)) {
    const sem = semanticOf(stage.id);
    if (isTestInfraStageSemantic(sem)) {
      if (/jest/i.test(sem)) {
        jest = true;
      }
      if (/babel/i.test(sem)) {
        babel = true;
      }
      if (/tsconfig/i.test(sem)) {
        tsconfig = true;
      }
    }
  }
  return { jest, babel, tsconfig };
}
