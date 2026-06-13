import * as fs from 'fs';
import * as path from 'path';

const ASYNCIO_MARK = /@pytest\.mark\.asyncio\b/;
const ASYNC_TEST_DEF = /^\s*async\s+def\s+test_/m;

function listTestPyFiles(testsDir: string): string[] {
  try {
    if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) {
      return [];
    }
    return fs
      .readdirSync(testsDir)
      .filter((name) => /^test_.*\.py$/i.test(name))
      .map((name) => path.join(testsDir, name));
  } catch {
    return [];
  }
}

/** tests/ 下是否存在需要 pytest-asyncio 的 async 测试。 */
export function testSuiteNeedsPytestAsyncio(effectiveCwd: string): boolean {
  const files = listTestPyFiles(path.join(path.resolve(effectiveCwd), 'tests'));
  for (const abs of files) {
    try {
      const content = fs.readFileSync(abs, 'utf8');
      if (ASYNCIO_MARK.test(content) || ASYNC_TEST_DEF.test(content)) {
        return true;
      }
    } catch {
      // ignore unreadable test file
    }
  }
  return false;
}

function sitePackagesDirs(venvLib: string): string[] {
  try {
    return fs
      .readdirSync(venvLib)
      .filter((name) => name.startsWith('python'))
      .map((name) => path.join(venvLib, name, 'site-packages'));
  } catch {
    return [];
  }
}

/** venv site-packages 是否已安装 pytest-asyncio。 */
export function pytestAsyncioInstalledInVenv(effectiveCwd: string): boolean {
  const venvLib = path.join(path.resolve(effectiveCwd), '.venv', 'lib');
  if (!fs.existsSync(venvLib)) {
    return false;
  }
  for (const site of sitePackagesDirs(venvLib)) {
    try {
      if (!fs.existsSync(site)) {
        continue;
      }
      const names = fs.readdirSync(site);
      if (names.some((n) => n === 'pytest_asyncio' || n.startsWith('pytest_asyncio-'))) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}
