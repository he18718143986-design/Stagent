import * as fs from 'fs';
import * as path from 'path';
import { conftestExistsOnDisk } from '../python-bootstrap/conftestTemplate';

export type PythonTestInfraArtifacts = {
  venvPython: boolean;
  requirementsTxt: boolean;
  conftest: boolean;
  pyprojectToml: boolean;
  testsSubdir: boolean;
};

export type PythonTestInfraDiscovery = {
  effectiveCwd: string;
  artifacts: PythonTestInfraArtifacts;
  /** flat layout：tests/ 在子目录且根目录无 conftest/pyproject pythonpath */
  needsFlatLayoutBootstrap: boolean;
};

function fileExists(dir: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(dir, name));
  } catch {
    return false;
  }
}

function hasTestsSubdir(dir: string): boolean {
  const testsDir = path.join(dir, 'tests');
  try {
    if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) {
      return false;
    }
    const names = fs.readdirSync(testsDir);
    return names.some((n) => /^test_.*\.py$/i.test(n));
  } catch {
    return false;
  }
}

function pyprojectHasPythonpath(dir: string): boolean {
  const abs = path.join(dir, 'pyproject.toml');
  if (!fs.existsSync(abs)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    return /pythonpath\s*=/i.test(raw) || /\[tool\.pytest\.ini_options\]/i.test(raw);
  } catch {
    return false;
  }
}

export function discoverPythonTestInfraOnDisk(effectiveCwd: string): PythonTestInfraDiscovery {
  const resolved = path.resolve(effectiveCwd);
  const artifacts: PythonTestInfraArtifacts = {
    venvPython: fileExists(resolved, '.venv/bin/python'),
    requirementsTxt: fileExists(resolved, 'requirements.txt'),
    conftest: conftestExistsOnDisk(resolved),
    pyprojectToml: fileExists(resolved, 'pyproject.toml'),
    testsSubdir: hasTestsSubdir(resolved),
  };
  const needsFlatLayoutBootstrap =
    artifacts.testsSubdir &&
    !artifacts.conftest &&
    !pyprojectHasPythonpath(resolved);
  return { effectiveCwd: resolved, artifacts, needsFlatLayoutBootstrap };
}
