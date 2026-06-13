import { ensureConftestOnDisk } from '../python-bootstrap/conftestTemplate';
import type { PythonTestInfraDiscovery } from './pythonDiskScan';
import { pytestAsyncioInstalledInVenv, testSuiteNeedsPytestAsyncio } from './pytestAsyncioScan';

export type MissingPythonTestInfraIssueCode =
  | 'missing-python-venv'
  | 'missing-python-flat-layout'
  | 'missing-pytest-asyncio'
  | 'missing-python-test-infrastructure';

export interface MissingPythonTestInfraIssue {
  code: MissingPythonTestInfraIssueCode;
  message: string;
  hint: string;
  discovery?: PythonTestInfraDiscovery;
  autoFixed?: string[];
}

function formatDiscovery(d: PythonTestInfraDiscovery): string {
  const a = d.artifacts;
  return [
    `cwd=${d.effectiveCwd}`,
    `venv=${a.venvPython}`,
    `requirements.txt=${a.requirementsTxt}`,
    `conftest=${a.conftest}`,
    `tests/=${a.testsSubdir}`,
    `flat-bootstrap-needed=${d.needsFlatLayoutBootstrap}`,
  ].join('; ');
}

export function buildMissingPythonTestInfraIssue(
  discovery: PythonTestInfraDiscovery,
  opts?: { autoFixConftest?: boolean },
): MissingPythonTestInfraIssue | null {
  const autoFixed: string[] = [];
  let working = discovery;

  if (opts?.autoFixConftest && working.needsFlatLayoutBootstrap) {
    const { written, path: conftestPath } = ensureConftestOnDisk(working.effectiveCwd);
    if (written) {
      autoFixed.push(`wrote ${conftestPath}`);
      working = {
        ...working,
        artifacts: { ...working.artifacts, conftest: true },
        needsFlatLayoutBootstrap: false,
      };
    }
  }

  if (!working.artifacts.venvPython) {
    return {
      code: 'missing-python-venv',
      message: `python-test-run-preflight：缺少 .venv/bin/python。请在 test_run 前完成 stage_venv_create / pip install。\n${formatDiscovery(working)}`,
      hint: '见 python-code-runner-constraint · VENV SETUP',
      discovery: working,
      ...(autoFixed.length ? { autoFixed } : {}),
    };
  }

  if (working.needsFlatLayoutBootstrap) {
    return {
      code: 'missing-python-flat-layout',
      message: `python-test-run-preflight：flat layout 下 tests/ 存在但缺少 conftest.py（或 pyproject.toml pythonpath）。pytest 将无法 import 顶层模块。\n${formatDiscovery(working)}`,
      hint: '添加 conftest.py（sys.path.insert 项目根）或设置 PYTHONPATH=.',
      discovery: working,
      ...(autoFixed.length ? { autoFixed } : {}),
    };
  }

  if (
    testSuiteNeedsPytestAsyncio(working.effectiveCwd) &&
    !pytestAsyncioInstalledInVenv(working.effectiveCwd)
  ) {
    return {
      code: 'missing-pytest-asyncio',
      message: `python-test-run-preflight：tests 使用 @pytest.mark.asyncio 但 venv 未安装 pytest-asyncio。\n${formatDiscovery(working)}`,
      hint: 'pip install "pytest-asyncio>=0.23.0" 或写入 requirements.txt 后 pip install -r requirements.txt',
      discovery: working,
      ...(autoFixed.length ? { autoFixed } : {}),
    };
  }

  return null;
}
