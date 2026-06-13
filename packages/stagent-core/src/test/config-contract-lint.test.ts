import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildConfigYamlAccessGuide,
  detectConfigContractIssues,
  extractYamlKeyNames,
  extractYamlTopLevelKeys,
  extractConfigKeyAccesses,
  extractInvokedScriptNames,
} from '../ConfigContractLint';

const FLAT_CONFIG_YAML = `# config
mock: true
price_diff_threshold_pct: 10.0
# 文件路径
input_file: "input.xlsx"
output_dir: "./output"
log_file: "diff.log"
`;

const SLICE2_READS_NESTED = `
import yaml
def load_config(p):
    with open(p) as f:
        return yaml.safe_load(f)

def main():
    config = load_config('config.yaml')
    paths = config.get('paths', {})
    input_excel = paths.get('input_excel')
    output_dir = paths.get('output_dir')
    output_csv = paths.get('output_csv')
`;

const T4_NESTED_CONFIG = `periods:
  primary: "3min"
risk:
  stop_loss_points: 15
broker:
  sim:
    initial_balance: 1000000
signals:
  long:
    vol_multiplier: 2
logging:
  level: INFO
`;

test('extractYamlTopLevelKeys 仅收集零缩进顶层键', () => {
  const keys = extractYamlTopLevelKeys(T4_NESTED_CONFIG);
  assert.deepEqual(keys, ['periods', 'risk', 'broker', 'signals', 'logging']);
});

test('buildConfigYamlAccessGuide 禁止 trade/modules 并给出嵌套示例', () => {
  const guide = buildConfigYamlAccessGuide(T4_NESTED_CONFIG);
  assert.match(guide, /禁止发明.*trade/);
  assert.match(guide, /cfg\['risk'\]/);
  assert.match(guide, /cfg\['broker'\]\['sim'\]/);
  assert.match(guide, /_DataGenerator/);
  assert.match(guide, /cfg\["modules"\]\["risk"\]/);
});

test('extractYamlKeyNames 收集任意层级键名', () => {
  const keys = extractYamlKeyNames(FLAT_CONFIG_YAML);
  assert.ok(keys.has('mock'));
  assert.ok(keys.has('input_file'));
  assert.ok(keys.has('output_dir'));
  assert.ok(!keys.has('input_excel'));
});

test('extractConfigKeyAccesses 跟踪 config 及其派生子变量的键访问', () => {
  const keys = extractConfigKeyAccesses(SLICE2_READS_NESTED);
  assert.ok(keys.includes('paths'));
  assert.ok(keys.includes('input_excel'));
  assert.ok(keys.includes('output_csv'));
});

test('extractInvokedScriptNames 抽取命令中的 .py basename', () => {
  const names = extractInvokedScriptNames('.venv/bin/python slice2_pipeline.py && python -c "x"');
  assert.deepEqual(names, ['slice2_pipeline.py']);
});

test('detectConfigContractIssues 命中跨阶段 config 键漂移（input_file vs paths.input_excel）', () => {
  const issues = detectConfigContractIssues({
    command: '.venv/bin/python slice2_pipeline.py',
    configFiles: [{ name: 'config.yaml', content: FLAT_CONFIG_YAML }],
    scripts: [{ name: 'slice2_pipeline.py', content: SLICE2_READS_NESTED }],
  });
  const keys = issues.map((i) => i.message);
  assert.ok(issues.length >= 2, '至少应报告 paths / input_excel 缺失');
  assert.ok(keys.some((m) => m.includes("'input_excel'")));
  assert.ok(keys.some((m) => m.includes("'paths'")));
  // output_dir 是顶层已有键 → 不应误报
  assert.ok(!keys.some((m) => m.includes("'output_dir'")));
  assert.ok(issues.every((i) => i.code === 'config-key-not-found'));
});

test('detectConfigContractIssues 键齐全时无问题（对齐后的 config）', () => {
  const aligned =
    FLAT_CONFIG_YAML +
    `
paths:
  input_excel: "input.xlsx"
  output_dir: "./output"
  output_csv: "./output/diff.csv"
`;
  const issues = detectConfigContractIssues({
    command: '.venv/bin/python slice2_pipeline.py',
    configFiles: [{ name: 'config.yaml', content: aligned }],
    scripts: [{ name: 'slice2_pipeline.py', content: SLICE2_READS_NESTED }],
  });
  assert.equal(issues.length, 0);
});

test('extractConfigKeyAccesses 排除函数 DI 误写（Run #39）', () => {
  const py = `
import yaml
with open('config.yaml') as f:
    config = yaml.safe_load(f)
compute_indicators = config.get("compute_indicators")
generate_signals = config.get("generate_signals")
data_source = config.get("data_source")
`;
  const keys = extractConfigKeyAccesses(py);
  assert.ok(!keys.includes('compute_indicators'));
  assert.ok(!keys.includes('generate_signals'));
  assert.ok(keys.includes('data_source'));
});

test('detectConfigContractIssues 不检查未加载 YAML 的脚本（避免对业务 dict 误报）', () => {
  const businessScript = `
def f(record):
    return record['ASIN'] + record.get('TK SKU', '')
config = {'foo': 1}
print(config.get('input_excel'))
`;
  const issues = detectConfigContractIssues({
    command: '.venv/bin/python differ.py',
    configFiles: [{ name: 'config.yaml', content: FLAT_CONFIG_YAML }],
    scripts: [{ name: 'differ.py', content: businessScript }],
  });
  assert.equal(issues.length, 0);
});
