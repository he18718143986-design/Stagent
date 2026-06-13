import type { TestInfraArtifacts } from './artifacts';
import { testInfraSatisfied } from './artifacts';
import type { TestInfraArtifactKind, TestInfraDiscovery } from './diskScan';

export type MissingTestInfraIssueCode =
  | 'missing-jest-config'
  | 'missing-babel-config'
  | 'missing-test-infrastructure';

export interface MissingTestInfraIssue {
  code: MissingTestInfraIssueCode;
  message: string;
  hint: string;
  discovery?: TestInfraDiscovery;
}

function formatKindDiscovery(
  kind: TestInfraArtifactKind,
  discovery: TestInfraDiscovery,
): string {
  const entries = discovery.found.filter((f) => f.kind === kind);
  const inEffective = entries.filter((e) => e.inEffectiveCwd);
  if (inEffective.length > 0) {
    return inEffective.map((e) => e.relPath).join(', ');
  }
  if (entries.length > 0) {
    return `${entries.map((e) => e.relPath).join(', ')} (not in effective cwd)`;
  }
  return '(none)';
}

export function formatTestInfraDiscoverySummary(discovery: TestInfraDiscovery): string {
  const checked = discovery.checkedDirs.join(', ');
  const jest = formatKindDiscovery('jest', discovery);
  const babel = formatKindDiscovery('babel', discovery);
  const tsconfig = formatKindDiscovery('tsconfig', discovery);
  return `checked: ${checked}; found: jest=${jest}; babel=${babel}; tsconfig=${tsconfig}`;
}

function appendDiscovery(base: string, discovery?: TestInfraDiscovery): string {
  if (!discovery) {
    return base;
  }
  return `${base}\n${formatTestInfraDiscoverySummary(discovery)}`;
}

/** M38.1 / M39.1 共用：根据 Expo 信号与已探测 artifact 构造缺失测试基础设施 issue。 */
export function buildMissingTestInfraIssue(
  expo: boolean,
  infra: TestInfraArtifacts,
  discovery?: TestInfraDiscovery,
): MissingTestInfraIssue | null {
  if (testInfraSatisfied(expo, infra)) {
    return null;
  }
  if (expo) {
    if (!infra.jest && !infra.babel) {
      return {
        code: 'missing-test-infrastructure',
        message: appendDiscovery(
          'test-run-preflight（M38.1）：Expo/RN 栈缺少 Jest 与 Babel 配置（jest.config.* 与 babel.config.*）。请在 test_run 前添加配置阶段或手动创建（含 jest-expo preset）。',
          discovery,
        ),
        hint: '见 README §能力边界 · SPEC M38.1',
        discovery,
      };
    }
    if (!infra.jest) {
      return {
        code: 'missing-jest-config',
        message: appendDiscovery(
          'test-run-preflight（M38.1）：Expo/RN 栈缺少 Jest 配置（jest.config.*）。请在 test_run 前添加 jest-expo 等 preset。',
          discovery,
        ),
        hint: '见 README §能力边界 · SPEC M38.1',
        discovery,
      };
    }
    if (!infra.babel) {
      return {
        code: 'missing-babel-config',
        message: appendDiscovery(
          'test-run-preflight（M38.1）：Expo/RN 栈缺少 Babel 配置（babel.config.*）。请在 test_run 前添加 babel-preset-expo 等配置。',
          discovery,
        ),
        hint: '见 README §能力边界 · SPEC M38.1',
        discovery,
      };
    }
    return null;
  }
  return {
    code: 'missing-test-infrastructure',
    message: appendDiscovery(
      'test-run-preflight（M38.1）：工作区缺少测试基础设施（jest.config.*、babel.config.* 或 tsconfig.json）。请在 test_run 前添加配置阶段或手动创建，避免 Jest 无法解析 TypeScript。',
      discovery,
    ),
    hint: '见 README §能力边界 · SPEC M38.1',
    discovery,
  };
}
