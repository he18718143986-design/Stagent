import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, '../../scripts/verify-smoke-output.mjs');

function runScript(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

function mkws() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-smoke-out-'));
}

test('verify-smoke-output: config 声明 output_json_path + 非平凡产出 → 通过', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(
      path.join(dir, 'config.yaml'),
      'csv_path: tasks.csv\noutput_json_path: output/summary.json\n',
    );
    fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'output', 'summary.json'),
      JSON.stringify({ todo: 2, in_progress: 1, done: 0, cancelled: 0 }),
    );
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    assert.match(out.stdout ?? '', /产出非平凡/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: 声明产出缺失 → 失败（exit 1，捕获 main 空转）', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'output_json_path: summary.json\n');
    // 不写 summary.json：模拟 main() 未被调用 / 未创建输出
    const out = runScript(dir);
    assert.equal(out.status, 1, out.stdout);
    assert.match(out.stderr ?? '', /产出缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: 产出全零/空 → 失败（exit 1，捕获空心绿）', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'output_json_path: summary.json\n');
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify({ todo: 0, in_progress: 0, done: 0, cancelled: 0 }),
    );
    const out = runScript(dir);
    assert.equal(out.status, 1, out.stdout);
    assert.match(out.stderr ?? '', /无意义/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: 无声明产出且无回落文件 → 跳过（exit 0，不制造假失败）', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'csv_path: tasks.csv\n');
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
    assert.match(out.stdout ?? '', /跳过产出断言/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: 回落 summary.json（无 config）非平凡 → 通过', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ done: 3 }));
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: status 保真——CSV 多状态但产出塌缩单一状态 → 失败（子任务 1d (b)）', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'csv_path: tasks.csv\noutput_json_path: summary.json\n');
    fs.writeFileSync(path.join(dir, 'tasks.csv'), 'title,priority,status\nA,2,todo\nB,3,in_progress\nC,4,done\n');
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify({ imported: 3, summary: { todo: 3, in_progress: 0, done: 0, cancelled: 0 } }),
    );
    const out = runScript(dir);
    assert.equal(out.status, 1, out.stdout);
    assert.match(out.stderr ?? '', /status 未透传/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: status 保真——产出正确反映多状态 → 通过', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'csv_path: tasks.csv\noutput_json_path: summary.json\n');
    fs.writeFileSync(path.join(dir, 'tasks.csv'), 'title,priority,status\nA,2,todo\nB,3,in_progress\nC,4,done\n');
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify({ imported: 3, summary: { todo: 1, in_progress: 1, done: 1, cancelled: 0 } }),
    );
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: status 保真——有过滤（sum≠行数）时不误判 → 通过', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'csv_path: tasks.csv\noutput_json_path: summary.json\n');
    fs.writeFileSync(path.join(dir, 'tasks.csv'), 'title,priority,status\nA,2,todo\nB,3,in_progress\nC,4,done\n');
    // 只导入 2 行（1 行被过滤）→ sum=2≠3 行 → 跳过保真断言
    fs.writeFileSync(
      path.join(dir, 'summary.json'),
      JSON.stringify({ todo: 1, in_progress: 1, done: 0, cancelled: 0 }),
    );
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verify-smoke-output: 产出放在子目录（声明根路径）也能解析 → 通过', () => {
  const dir = mkws();
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'output_json_path: summary.json\n');
    fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
    // 模型实际写进 output/ 子目录
    fs.writeFileSync(path.join(dir, 'output', 'summary.json'), JSON.stringify({ todo: 1 }));
    const out = runScript(dir);
    assert.equal(out.status, 0, out.stderr || out.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
