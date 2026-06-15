import { uiMsg } from './uiStrings';

/** Resolve lint / plan / contract message by nls key (code doubles as key when prefixed). */
export function lintMsg(key: string, ...args: Array<string | number>): string {
  const resolved = uiMsg(key, ...args);
  if (resolved === key) {
    console.warn(`[stagent] missing l10n key: ${key}`);
  }
  return resolved;
}

/** Lint codes use `stagent.lint.{code}` where code uses dots → already full key if starts with stagent. */
export function lintMsgForCode(code: string, ...args: Array<string | number>): string {
  const key = code.startsWith('stagent.') ? code : `stagent.lint.${code}`;
  return lintMsg(key, ...args);
}

export function contractWarningMsg(kind: string, ...args: Array<string | number>): string {
  return lintMsg(`stagent.contract.${kind}`, ...args);
}

export function planCompletenessMsg(type: string, ...args: Array<'expo' | string | number>): string {
  if (type === 'missing-test-infrastructure' && args[0] === 'expo') {
    return lintMsg('stagent.planCompleteness.missingTestInfrastructureExpo');
  }
  if (type === 'missing-self-heal-chain' && typeof args[0] === 'string') {
    return lintMsg('stagent.planCompleteness.missingSelfHealChain', args[0]);
  }
  if (type === 'template-stage-cap-exceeded' && typeof args[0] === 'string') {
    return lintMsg('stagent.planCompleteness.templateStageCapExceeded', args[0]);
  }
  if (type === 'multi-file-prompt-mismatch' && typeof args[0] === 'string' && typeof args[1] === 'string') {
    return lintMsg('stagent.planCompleteness.multiFilePromptMismatch', args[0], args[1]);
  }
  if (type === 'test-stack-nestjs-mismatch' && typeof args[0] === 'string' && typeof args[1] === 'string') {
    return lintMsg('stagent.planCompleteness.testStackNestjsMismatch', args[0], args[1]);
  }
  if (type === 'upstream-fix-no-impl' && typeof args[0] === 'string') {
    return lintMsg('stagent.planCompleteness.upstreamFixNoImpl', args[0]);
  }
  if (
    type === 'upstream-fix-stack-routing' &&
    typeof args[0] === 'string' &&
    typeof args[1] === 'string' &&
    typeof args[2] === 'string' &&
    typeof args[3] === 'string'
  ) {
    return lintMsg('stagent.planCompleteness.upstreamFixStackRouting', args[0], args[1], args[2], args[3]);
  }
  if (
    type === 'test-write-import-not-in-plan' &&
    typeof args[0] === 'string' &&
    typeof args[1] === 'string' &&
    typeof args[2] === 'string'
  ) {
    return lintMsg('stagent.planCompleteness.testWriteImportNotInPlan', args[0], args[1], args[2]);
  }
  if (type === 'test-write-import-undeclared' && typeof args[0] === 'string' && typeof args[1] === 'string') {
    return lintMsg('stagent.planCompleteness.testWriteImportUndeclared', args[0], args[1]);
  }
  if (type === 'missing-test-run-pair' && typeof args[0] === 'string' && typeof args[1] === 'string') {
    return lintMsg('stagent.planCompleteness.missingTestRunPair', args[0], args[1]);
  }
  const camel = type.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return lintMsg(`stagent.planCompleteness.${camel}`, ...args);
}

export function decisionLintMsg(code: string, ...args: Array<string | number>): string {
  const camel = code.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return lintMsg(`stagent.decisionLint.${camel}`, ...args);
}
