export const MULTI_MODULE_USER_INPUT_RE =
  /完整项目|多模块|全栈|全栈项目|端到端|管理系统.*小程序|小程序.*管理后台|multiple\s+modules|full[\s-]?stack|full\s+project/i;

export function userHintsMultiModuleOrFullProject(userInput: string): boolean {
  return MULTI_MODULE_USER_INPUT_RE.test(userInput);
}
