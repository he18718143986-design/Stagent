/**
 * M39.2：DecisionRecord ↔ impl ↔ test SDK/路径契约 lint。
 *
 * 检测决策清单声明的 SDK 族（如 Firebase Web vs @react-native-firebase）与
 * 已落盘 impl/test 源码 import 是否一致；以及测试里相对 import/mock 路径是否在计划 artifact 中。
 *
 * 默认 warning-only（`stagent.execution.sdkPathContractLint=warn`）；`hard` 时在 test_run 前阻断。
 */
import {
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
  STAGE_ID_PREFIX_IMPL,
} from './workflow/StageIdPatterns';
import type { WorkflowDefinition } from './WorkflowDefinition';
import type { ProjectFile } from './CrossFileKeyContractLint';
import {
  normalizeArtifactRelativePath,
  type WorkflowArtifactRegistry,
} from './WorkflowArtifactRegistry';
import { lintMsg } from './l10n/lintMsg';
import { pushCodedLintIssue } from './lint/CodedLintIssue';
import { writeOutputToFileOf } from './workflow/StageToolConfigAccess';
import {
  importPathCoveredByArtifacts,
  registryCoversPythonTopLevelModule,
} from './artifact-registry/importPathCoverage';
import { extractRelativeImportSpecs } from './ImportExtract';
import { isExternalPythonModuleRoot } from './python-contract/pythonExternalModules';
import type { CommitmentSnapshot } from './commitment';

export type SdkFamily = 'firebase-web' | 'firebase-rn' | 'expo' | 'supabase' | 'clerk';

export type SdkPathContractIssueCode =
  | 'decision-impl-sdk-mismatch'
  | 'decision-test-sdk-mismatch'
  | 'impl-test-sdk-mismatch'
  | 'test-import-path-not-in-plan';

export interface SdkPathContractIssue {
  code: SdkPathContractIssueCode;
  message: string;
}

const TS_JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const PY_EXT = /\.py$/i;
const PY_FROM_IMPORT_RE = /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+/gm;
const TEST_PATH_HINT = /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.(ts|tsx|js|jsx)$/i;

const FIREBASE_WEB_MARKERS: RegExp[] = [
  /from\s+['"]firebase\/app['"]/,
  /from\s+['"]firebase\/auth['"]/,
  /from\s+['"]firebase\/firestore['"]/,
  /import\s+\{[^}]*\}\s+from\s+['"]firebase\//,
  /\bfirebase\/app\b/,
  /Firebase\s+Web\s+SDK/i,
  /modular\s+firebase/i,
  /`firebase\/app`/i,
];

const FIREBASE_RN_MARKERS: RegExp[] = [
  /from\s+['"]@react-native-firebase\//,
  /require\s*\(\s*['"]@react-native-firebase\//,
  /@react-native-firebase\/[a-z]+/,
  /react-native-firebase/i,
  /`@react-native-firebase\//,
];

const EXPO_MARKERS: RegExp[] = [
  /from\s+['"]expo['"]/,
  /from\s+['"]expo-router['"]/,
  /\bexpo-av\b/,
  /\bjest-expo\b/,
  /React\s+Native\s+\+\s+Expo/i,
  /\bExpo\s+SDK\b/i,
];

const SUPABASE_MARKERS: RegExp[] = [
  /from\s+['"]@supabase\/supabase-js['"]/,
  /createClient\s*\(/,
  /\bSupabase\b/i,
  /@supabase\//,
];

const CLERK_MARKERS: RegExp[] = [
  /from\s+['"]@clerk\/[^'"]+['"]/,
  /\bClerkProvider\b/,
  /\buseAuth\s*\(/,
  /@clerk\//,
];

function extractRelativeImports(content: string): string[] {
  return extractRelativeImportSpecs(content);
}

export function detectSdkFamilies(text: string): Set<SdkFamily> {
  const families = new Set<SdkFamily>();
  if (FIREBASE_WEB_MARKERS.some((re) => re.test(text))) {
    families.add('firebase-web');
  }
  if (FIREBASE_RN_MARKERS.some((re) => re.test(text))) {
    families.add('firebase-rn');
  }
  if (EXPO_MARKERS.some((re) => re.test(text))) {
    families.add('expo');
  }
  if (SUPABASE_MARKERS.some((re) => re.test(text))) {
    families.add('supabase');
  }
  if (CLERK_MARKERS.some((re) => re.test(text))) {
    families.add('clerk');
  }
  return families;
}

function formatFamilySet(families: Set<SdkFamily>): string {
  return [...families].sort().join(', ') || '(none)';
}

function classifyFileRole(
  filePath: string,
  workflow: WorkflowDefinition,
): 'impl' | 'test' | 'other' {
  const norm = normalizeArtifactRelativePath(filePath);
  for (const stage of workflow.stages ?? []) {
    const out = writeOutputToFileOf(stage);
    if (!out || normalizeArtifactRelativePath(out) !== norm) {
      continue;
    }
    if (isImplStageId(stage.id)) {
      return 'impl';
    }
    if (isTestRunStageId(stage.id) || isTestWriteStageId(stage.id)) {
      return 'test';
    }
  }
  if (TEST_PATH_HINT.test(norm)) {
    return 'test';
  }
  if (norm.includes(STAGE_ID_PREFIX_IMPL) || /\/src\//.test(norm)) {
    return 'impl';
  }
  return 'other';
}

function firebaseFamiliesConflict(a: Set<SdkFamily>, b: Set<SdkFamily>): boolean {
  const aWeb = a.has('firebase-web');
  const aRn = a.has('firebase-rn');
  const bWeb = b.has('firebase-web');
  const bRn = b.has('firebase-rn');
  return (aWeb && bRn) || (aRn && bWeb);
}

function collectFamiliesFromCommitments(
  snapshots: Array<{ stageId: string; snapshot: CommitmentSnapshot }>,
): Set<SdkFamily> {
  const families = new Set<SdkFamily>();
  for (const { snapshot } of snapshots) {
    for (const c of snapshot.commitments) {
      if (c.kind === 'sdk_family' && isSdkFamily(c.subject)) {
        families.add(c.subject);
      }
    }
  }
  return families;
}

function isSdkFamily(subject: string): subject is SdkFamily {
  return (
    subject === 'firebase-web' ||
    subject === 'firebase-rn' ||
    subject === 'expo' ||
    subject === 'supabase' ||
    subject === 'clerk'
  );
}

export function lintSdkPathContract(input: {
  workflow: WorkflowDefinition;
  files: ProjectFile[];
  decisionRecords: Array<{ stageId: string; text: string }>;
  commitmentSnapshots?: Array<{ stageId: string; snapshot: CommitmentSnapshot }>;
  registry: WorkflowArtifactRegistry;
}): SdkPathContractIssue[] {
  const { workflow, files, decisionRecords, commitmentSnapshots, registry } = input;
  const issues: SdkPathContractIssue[] = [];

  const decisionFamilies = new Set<SdkFamily>();
  const fromCommitments =
    commitmentSnapshots && commitmentSnapshots.length > 0
      ? collectFamiliesFromCommitments(commitmentSnapshots)
      : new Set<SdkFamily>();
  for (const f of fromCommitments) {
    decisionFamilies.add(f);
  }
  if (decisionFamilies.size === 0) {
    for (const dr of decisionRecords) {
      for (const f of detectSdkFamilies(dr.text)) {
        decisionFamilies.add(f);
      }
    }
  }

  const implFamilies = new Set<SdkFamily>();
  const testFamilies = new Set<SdkFamily>();
  const implFiles: ProjectFile[] = [];
  const testFiles: ProjectFile[] = [];

  for (const file of files) {
    if (!TS_JS_EXT.test(file.path) && !PY_EXT.test(file.path)) {
      continue;
    }
    const role = classifyFileRole(file.path, workflow);
    const families = detectSdkFamilies(file.content);
    if (role === 'impl') {
      implFiles.push(file);
      for (const f of families) {
        implFamilies.add(f);
      }
    } else if (role === 'test') {
      testFiles.push(file);
      for (const f of families) {
        testFamilies.add(f);
      }
    }
  }

  if (decisionFamilies.size > 0 && implFamilies.size > 0 && firebaseFamiliesConflict(decisionFamilies, implFamilies)) {
    pushCodedLintIssue(
      issues,
      'decision-impl-sdk-mismatch',
      lintMsg(
        'stagent.lint.sdkDecisionImplMismatch',
        formatFamilySet(decisionFamilies),
        formatFamilySet(implFamilies),
      ),
    );
  }

  if (decisionFamilies.size > 0 && testFamilies.size > 0 && firebaseFamiliesConflict(decisionFamilies, testFamilies)) {
    pushCodedLintIssue(
      issues,
      'decision-test-sdk-mismatch',
      lintMsg(
        'stagent.lint.sdkDecisionTestMismatch',
        formatFamilySet(decisionFamilies),
        formatFamilySet(testFamilies),
      ),
    );
  }

  if (implFamilies.size > 0 && testFamilies.size > 0 && firebaseFamiliesConflict(implFamilies, testFamilies)) {
    pushCodedLintIssue(
      issues,
      'impl-test-sdk-mismatch',
      lintMsg('stagent.lint.sdkImplTestMismatch', formatFamilySet(implFamilies), formatFamilySet(testFamilies)),
    );
  }

  for (const tf of testFiles) {
    for (const imp of extractRelativeImports(tf.content)) {
      if (importPathCoveredByArtifacts(imp, registry)) {
        continue;
      }
      pushCodedLintIssue(
        issues,
        'test-import-path-not-in-plan',
        lintMsg('stagent.lint.testImportPathNotInPlan', tf.path, imp),
      );
    }
    if (PY_EXT.test(tf.path)) {
      PY_FROM_IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PY_FROM_IMPORT_RE.exec(tf.content)) !== null) {
        const mod = m[1]!.split('.')[0]!;
        if (mod.startsWith('.') || isExternalPythonModuleRoot(mod)) {
          continue;
        }
        if (!registryCoversPythonTopLevelModule(registry, mod)) {
          pushCodedLintIssue(
            issues,
            'test-import-path-not-in-plan',
            lintMsg('stagent.lint.testImportPathNotInPlan', tf.path, mod),
          );
        }
      }
    }
  }

  return issues;
}

export function sdkPathContractIssuesToWarnings(issues: SdkPathContractIssue[]): string[] {
  return issues.map((i) => `[M39.2 ${i.code}] ${i.message}`);
}

export function collectDecisionRecordsFromInstance(
  workflow: WorkflowDefinition,
  decisionOutputs: Array<{ stageId: string; decisionRecord?: unknown }>,
): Array<{ stageId: string; text: string }> {
  const byStage = new Map(decisionOutputs.map((d) => [d.stageId, d.decisionRecord]));
  const out: Array<{ stageId: string; text: string }> = [];
  for (const stage of workflow.stages ?? []) {
    if (!stage.isDecisionStage) {
      continue;
    }
    const raw = byStage.get(stage.id) ?? undefined;
    if (typeof raw === 'string' && raw.trim()) {
      out.push({ stageId: stage.id, text: raw });
    }
  }
  return out;
}
