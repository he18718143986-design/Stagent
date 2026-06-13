/** pytest 执行时若未设置 PYTHONPATH，prepend `.` 以支持 flat layout。 */
export function applyPytestEnv(
  command: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!/\bpytest\b/i.test(command)) {
    return env;
  }
  if (env.PYTHONPATH && env.PYTHONPATH.trim() !== '') {
    return env;
  }
  return { ...env, PYTHONPATH: '.' };
}
