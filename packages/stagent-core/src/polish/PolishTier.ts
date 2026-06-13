/** 用户选择的润色档位；auto 由引擎根据草稿推断。 */
export type PolishTierRequest = 'auto' | 'light' | 'standard';

/** 实际用于构建提示词与缓存的档位（已解析 auto）。 */
export type ResolvedPolishTier = 'light' | 'standard';

const LIGHT_HINTS =
  /脚本|计算器|算式|单文件|简单|小工具|一次性|hello|greet|冒烟|最小|MVP|CLI|命令行|几行|一个文件/i;
const COMPLEX_HINTS =
  /全栈|微服务|多模块|架构|重构|refactor|垂直切片|npm\s*子项目|VS\s*Code\s*扩展|前后端|分布式|AFK|多切片|集成测试链|工作流引擎/i;

/** 根据草稿启发式推断轻量 vs 完整（仅用于 polishTier=auto）。 */
export function inferPolishTierFromDraft(draft: string): ResolvedPolishTier {
  const t = draft.trim();
  if (!t) {
    return 'light';
  }
  let light = 0;
  let complex = 0;
  if (t.length <= 200) {
    light += 2;
  } else if (t.length <= 500) {
    light += 1;
  } else if (t.length >= 1200) {
    complex += 2;
  }
  if (LIGHT_HINTS.test(t)) {
    light += 2;
  }
  if (COMPLEX_HINTS.test(t)) {
    complex += 3;
  }
  return complex >= light ? 'standard' : 'light';
}

export function resolvePolishTier(requested: PolishTierRequest | undefined, draft: string): ResolvedPolishTier {
  if (requested === 'light' || requested === 'standard') {
    return requested;
  }
  return inferPolishTierFromDraft(draft);
}

export function isPolishTierRequest(value: string | undefined): value is PolishTierRequest {
  return value === 'auto' || value === 'light' || value === 'standard';
}
