import * as fs from 'fs';
import * as path from 'path';
import type { CodeRunnerConfig } from '../WorkflowDefinition';
import { discoverPythonTestInfraOnDisk } from '../test-infra/pythonDiskScan';

export function venvPythonExists(cwd: string): boolean {
  return discoverPythonTestInfraOnDisk(cwd).artifacts.venvPython;
}

export function buildVenvCreateRunnerConfig(cwd: string): CodeRunnerConfig {
  return {
    type: 'code-runner',
    command: 'python3 -m venv .venv',
    captureOutput: true,
    pathBase: 'workspace',
    workingDir: cwd === '.' ? '.' : cwd,
  };
}

export function buildVenvPipRunnerConfig(cwd: string, useRequirements: boolean): CodeRunnerConfig {
  const pipCmd = useRequirements
    ? '.venv/bin/python -m pip install -r requirements.txt'
    : '.venv/bin/python -m pip install pytest';
  return {
    type: 'code-runner',
    command: pipCmd,
    captureOutput: true,
    pathBase: 'workspace',
    workingDir: cwd === '.' ? '.' : cwd,
  };
}

export function requirementsTxtOnDisk(workspaceRoot: string, cwd: string): boolean {
  const abs = path.resolve(workspaceRoot, cwd === '.' ? '' : cwd, 'requirements.txt');
  try {
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}
