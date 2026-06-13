/** 绿场 Python 多模块骨架模板版本（PRD §8.4）。 */
export const GREENFIELD_PYTHON_SKELETON_VERSION = 'greenfield-python-v2';

/** 骨架展开后 llm-text 占位 systemPrompt 前缀（语义填充前）。 */
export const SKELETON_PROMPT_PLACEHOLDER_PREFIX = '[骨架模板 · 待语义填充]';

export const GLOBAL_CONFIG_DECIDE_STAGE_ID = 'stage_decide_architecture_overview';

/** T4 类需求在 token 提取不足时的默认垂直切片语义。 */
export const T4_DEFAULT_SLICE_MODULES = [
  'indicators',
  'signals',
  'risk',
  'broker',
  'main',
] as const;
