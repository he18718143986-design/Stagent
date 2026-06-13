import * as fs from 'fs';
import * as path from 'path';

/**
 * 执行期「配置键契约」lint：在 code-runner 运行 Python 脚本前，读取磁盘上已生成的 config.*.yaml 与被调用脚本，
 * 检测脚本读取的 config 键是否真的在配置文件中存在。专治「不同 llm-text 阶段各自给 config 起名」导致的
 * 跨阶段契约漂移（例：config.yaml 写 input_file，slice2_pipeline.py 读 paths.input_excel → 运行期才崩）。
 *
 * 设计取舍：
 * - 只在「脚本确实加载了 YAML 配置（出现 yaml.safe_load/load）」时才检查，避免对无关 dict 误报。
 * - 键集合按「任意嵌套层级出现过的键名」取并集，宽松匹配，宁可漏报也尽量不误报、不误阻断。
 * - 仅追踪「被污染（config 衍生）」的变量上的 .get('k') / ['k'] 访问，避免把 record['ASIN'] 之类业务字典误判为配置访问。
 */
export interface ConfigContractIssue {
  code: 'config-key-not-found';
  message: string;
}

/** config 根变量的常见命名；这些名字上的 .get/[] 访问会被视为配置访问（前提是脚本确实加载了 YAML）。 */
const CONFIG_ROOT_VAR_NAMES = ['config', 'cfg', 'conf', 'settings', 'configuration'];

const YAML_LOAD_RE = /yaml\.(?:safe_load|full_load|load)\s*\(/;

/** main.py 常见幻觉顶层键（T4 Run #43：trade/modules/data_source 等）。 */
export const FORBIDDEN_INVENTED_CONFIG_TOP_LEVEL_KEYS = [
  'trade',
  'modules',
  'data_source',
  'paths',
  'initial_capital',
  'interval_seconds',
  'type',
  'path',
  'mode',
  'data',
] as const;

/** 从 YAML 文本抽取顶层（零缩进）键名。 */
export function extractYamlTopLevelKeys(yamlText: string): string[] {
  const keys: string[] = [];
  for (const rawLine of yamlText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    const m = /^([A-Za-z_][\w.-]*)\s*:(?:\s|$)/.exec(line);
    if (m) {
      keys.push(m[1]);
    }
  }
  return keys;
}

/** 从 YAML 生成 cfg['a']['b'] 形式访问示例（顶层 + 一层子键，供 main.py prompt SSOT）。 */
export function buildConfigYamlAccessExamples(yamlText: string): string[] {
  const examples: string[] = [];
  const lines = yamlText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '');
    const topM = /^([A-Za-z_][\w.-]*)\s*:/.exec(line);
    if (!topM) {
      continue;
    }
    const top = topM[1];
    examples.push(`cfg['${top}']`);
    for (let j = i + 1; j < lines.length; j++) {
      const childLine = lines[j].replace(/#.*$/, '');
      if (/^\S/.test(childLine) && childLine.trim()) {
        break;
      }
      const childM = /^\s{2}([A-Za-z_][\w.-]*)\s*:/.exec(childLine);
      if (childM) {
        examples.push(`cfg['${top}']['${childM[1]}']`);
      }
    }
  }
  return [...new Set(examples)].slice(0, 14);
}

/** main.py 入口脚本 config 访问指南（嵌套路径 + 禁止幻觉键）。 */
export function buildConfigYamlAccessGuide(yamlText: string): string {
  const topKeys = extractYamlTopLevelKeys(yamlText);
  const examples = buildConfigYamlAccessExamples(yamlText);
  const forbidden = FORBIDDEN_INVENTED_CONFIG_TOP_LEVEL_KEYS.filter((k) => !topKeys.includes(k));
  const lines = [
    '【config 访问模式（main.py 必读）】',
    `允许顶层键（仅此）：${topKeys.join(', ') || '（见下方 YAML）'}`,
    `禁止发明下列顶层键：${forbidden.join(', ')}`,
  ];
  if (examples.length) {
    lines.push('推荐访问示例（对齐语义，勿发明新键）：');
    for (const ex of examples) {
      lines.push(`- ${ex}`);
    }
  }
  const hints: string[] = [];
  if (topKeys.includes('risk')) {
    hints.push('RiskManager 用 cfg["risk"]，勿用 cfg["modules"]["risk"]');
  }
  if (topKeys.includes('broker')) {
    hints.push('SimBroker 初始资金用 cfg["broker"]["sim"]["initial_balance"]，勿用 cfg["trade"]["initial_capital"]');
  }
  if (topKeys.includes('signals')) {
    hints.push('信号参数用 cfg["signals"]，勿用 cfg["modules"]["signals"]');
  }
  if (topKeys.includes('logging')) {
    hints.push('日志用 cfg["logging"]');
  }
  if (hints.length) {
    lines.push('切片对齐：', ...hints.map((h) => `- ${h}`));
  }
  lines.push(
    '模拟 K 线：内置 _DataGenerator（main 模块内，不 export），勿读 cfg["data_source"]；轮询间隔可硬编码常量或读 periods。',
  );
  return lines.join('\n');
}

/** 从 YAML 文本抽取所有出现过的键名（任意嵌套层级）。最小实现，不依赖 YAML 解析库。 */
export function extractYamlKeyNames(yamlText: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of yamlText.split(/\r?\n/)) {
    // 去掉行内注释（键已在 ':' 之前，安全）。
    const line = rawLine.replace(/#.*$/, '');
    // 跳过列表项（'- ' 开头）；匹配 `  key:` 形式的映射键。
    const m = /^\s*([A-Za-z_][\w.-]*)\s*:(?:\s|$)/.exec(line);
    if (m) {
      keys.add(m[1]);
    }
  }
  return keys;
}

/** 抽取脚本中「对 config 派生变量」的键访问（.get('k') 与 ['k']）。 */
export function extractConfigKeyAccesses(pyText: string): string[] {
  const tainted = new Set<string>(CONFIG_ROOT_VAR_NAMES);
  // 1) 直接由 yaml.load 赋值的变量。
  const assignYaml = /(\b[A-Za-z_]\w*)\s*=\s*yaml\.(?:safe_load|full_load|load)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = assignYaml.exec(pyText))) {
    tainted.add(m[1]);
  }
  // 2) 由已污染变量经 .get('k') / ['k'] 派生出的子变量（迭代到不动点，封顶几轮防极端）。
  const reSub =
    /(\b[A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*(?:\.get\(\s*['"][^'"]+['"]|\[\s*['"][^'"]+['"]\s*\])/g;
  for (let i = 0; i < 4; i++) {
    const before = tainted.size;
    reSub.lastIndex = 0;
    while ((m = reSub.exec(pyText))) {
      if (tainted.has(m[2])) {
        tainted.add(m[1]);
      }
    }
    if (tainted.size === before) {
      break;
    }
  }
  // 2.5) 收集被成员测试守卫的「可选键」：`'k' in config` / `"k" not in cfg`。
  //      Python 里 `if 'k' in config:` 是可选键的标准写法，缺失合法，不应算必需键引用（否则误阻断）。
  const guarded = extractMembershipGuardedKeys(pyText, tainted);
  // 3) 收集所有污染变量上的键访问（排除被守卫的可选键）。
  const keys = new Set<string>();
  for (const v of tainted) {
    const reGet = new RegExp(`\\b${v}\\s*\\.get\\(\\s*['"]([^'"]+)['"]`, 'g');
    const reIdx = new RegExp(`\\b${v}\\s*\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
    let g: RegExpExecArray | null;
    while ((g = reGet.exec(pyText))) {
      keys.add(g[1]);
    }
    while ((g = reIdx.exec(pyText))) {
      keys.add(g[1]);
    }
  }
  for (const k of guarded) {
    keys.delete(k);
  }
  // 4) 排除 config DI 误写：`compute_indicators = config.get("compute_indicators")`（T4 Run #39）。
  //    变量名与键名相同表示试图从配置注入可调用对象，不是真实配置键。
  for (const k of extractConfigDependencyInjectionKeys(pyText)) {
    keys.delete(k);
  }
  return [...keys];
}

/** 常见误将模块/函数注入 config 的键名（T4 Run #39）；仅单参 config.get 同名赋值时排除。 */
const CONFIG_CALLABLE_INJECTION_KEYS = new Set([
  'compute_indicators',
  'generate_signals',
  'apply_risk_control',
  'risk_manager',
  'compute_ma',
  'compute_boll',
  'compute_vol',
  'compute_macd',
  'compute_cci',
]);

/** `var = config.get("var")` 单参且键名在注入 denylist → 非配置键。 */
export function extractConfigDependencyInjectionKeys(pyText: string): Set<string> {
  const di = new Set<string>();
  for (const v of CONFIG_ROOT_VAR_NAMES) {
    const re = new RegExp(
      String.raw`(\b[A-Za-z_]\w*)\s*=\s*${v}\.get\(\s*['"]([^'"]+)['"]\s*\)`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(pyText))) {
      const key = m[2];
      if (m[1] === key && CONFIG_CALLABLE_INJECTION_KEYS.has(key)) {
        di.add(key);
      }
    }
  }
  return di;
}

/** 收集被 `'k' in <configvar>` / `'k' not in <configvar>` 成员测试守卫的键名（视为可选键）。 */
export function extractMembershipGuardedKeys(pyText: string, taintedVars: Set<string>): Set<string> {
  const guarded = new Set<string>();
  const re = /['"]([^'"]+)['"]\s+(?:not\s+)?in\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pyText))) {
    if (taintedVars.has(m[2])) {
      guarded.add(m[1]);
    }
  }
  return guarded;
}

/** 从 code-runner 命令里抽取被直接调用的 .py 脚本名（如 `.venv/bin/python slice2_pipeline.py`）。 */
export function extractInvokedScriptNames(command: string): string[] {
  const names = new Set<string>();
  const re = /([\w./-]+\.py)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) {
    // 仅保留 basename，配合工作目录读取。
    names.add(path.basename(m[1]));
  }
  return [...names];
}

/** 纯函数核心：给定命令、配置文件内容、脚本内容，返回配置键契约问题。 */
export function detectConfigContractIssues(input: {
  command: string;
  configFiles: { name: string; content: string }[];
  scripts: { name: string; content: string }[];
}): ConfigContractIssue[] {
  const keyUnion = new Set<string>();
  for (const cf of input.configFiles) {
    for (const k of extractYamlKeyNames(cf.content)) {
      keyUnion.add(k);
    }
  }
  if (keyUnion.size === 0) {
    return [];
  }
  const configLabel = input.configFiles.map((c) => c.name).join(' / ');
  const existing = [...keyUnion].sort().join(', ');
  const issues: ConfigContractIssue[] = [];
  const reported = new Set<string>();
  for (const s of input.scripts) {
    if (!YAML_LOAD_RE.test(s.content)) {
      continue;
    }
    for (const key of extractConfigKeyAccesses(s.content)) {
      if (keyUnion.has(key)) {
        continue;
      }
      const dedup = `${s.name}:${key}`;
      if (reported.has(dedup)) {
        continue;
      }
      reported.add(dedup);
      issues.push({
        code: 'config-key-not-found',
        message:
          `${s.name} 读取配置键 '${key}'，但 ${configLabel} 未定义该键` +
          `（现有键：${existing}）。请统一命名：在配置中补充该键，或改脚本使用现有键名。`,
      });
    }
  }
  return issues;
}

function safeRead(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * 磁盘侧封装：读取工作目录下的 *.yaml/*.yml 与命令中被调用的脚本，执行配置键契约检查。
 * 任何异常一律吞掉返回空数组——lint 自身绝不阻断正常执行。
 */
export function collectConfigContractIssuesOnDisk(command: string, workspaceDir: string): ConfigContractIssue[] {
  try {
    if (!workspaceDir || !fs.existsSync(workspaceDir)) {
      return [];
    }
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    const configFiles = entries
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => ({ name: e.name, content: safeRead(path.join(workspaceDir, e.name)) }))
      .filter((c): c is { name: string; content: string } => typeof c.content === 'string');
    if (configFiles.length === 0) {
      return [];
    }
    const scripts = extractInvokedScriptNames(command)
      .map((name) => ({ name, content: safeRead(path.join(workspaceDir, name)) }))
      .filter((c): c is { name: string; content: string } => typeof c.content === 'string');
    if (scripts.length === 0) {
      return [];
    }
    return detectConfigContractIssues({ command, configFiles, scripts });
  } catch {
    return [];
  }
}
