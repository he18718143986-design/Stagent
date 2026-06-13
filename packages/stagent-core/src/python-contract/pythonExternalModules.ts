import externalRoots from '../../scripts/python-external-module-roots.json';

/**
 * Python 绝对 import 的顶层包名：标准库 + 常见第三方（非 workflow artifact）。
 * verify-python-test-imports（pre-impl 默认）跳过白名单内包；项目内模块 soft-skip（§5.6#6）。
 * --strict 档恢复项目内模块落盘校验。SSOT：scripts/python-external-module-roots.json
 */
const EXTERNAL_PYTHON_MODULE_ROOTS = new Set(
  (externalRoots as string[]).map((r) => r.toLowerCase()),
);

export function isExternalPythonModuleRoot(name: string): boolean {
  const root = name.split('.')[0]!.toLowerCase();
  return EXTERNAL_PYTHON_MODULE_ROOTS.has(root);
}
