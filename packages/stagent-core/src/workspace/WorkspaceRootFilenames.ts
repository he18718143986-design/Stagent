/** 工作区根常见文件名 / 目录（单点定义，避免散落字面量）。 */

export const WORKSPACE_PACKAGE_JSON = 'package.json';
export const WORKSPACE_PACKAGE_LOCK_JSON = 'package-lock.json';
export const WORKSPACE_TSCONFIG_JSON = 'tsconfig.json';
export const WORKSPACE_TSCONFIG_APP_JSON = 'tsconfig.app.json';
export const WORKSPACE_TSCONFIG_NODE_JSON = 'tsconfig.node.json';
export const WORKSPACE_SRC_DIR = 'src';

export function isWorkspaceTsconfigBasename(base: string): boolean {
  const b = base.toLowerCase();
  return (
    b === WORKSPACE_TSCONFIG_JSON ||
    b === WORKSPACE_TSCONFIG_APP_JSON ||
    b === WORKSPACE_TSCONFIG_NODE_JSON
  );
}

export const ZOOM_OUT_FALLBACK_CANDIDATES: readonly string[] = [
  WORKSPACE_PACKAGE_JSON,
  WORKSPACE_TSCONFIG_JSON,
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'README.md',
  `${WORKSPACE_SRC_DIR}/index.ts`,
  `${WORKSPACE_SRC_DIR}/main.ts`,
  `${WORKSPACE_SRC_DIR}/app.ts`,
];
