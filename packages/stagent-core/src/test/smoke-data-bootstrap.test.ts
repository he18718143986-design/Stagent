import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractCsvPathsFromYaml,
  seedSmokeCsvFixtures,
  inferCsvColumns,
  inferFirstEnumValue,
  buildSeedCsv,
} from '../disk-bootstrap/smokeDataBootstrap';

test('extractCsvPathsFromYaml 收集 mock_csv_path 等引用', () => {
  const yaml = `
broker:
  mock_csv_path: "./data/mock_kline.csv"
  index_csv_path: "./data/mock_index.csv"
`;
  const paths = extractCsvPathsFromYaml(yaml);
  assert.deepEqual(paths.sort(), ['./data/mock_index.csv', './data/mock_kline.csv']);
});

test('seedSmokeCsvFixtures 幂等创建缺失 CSV（Run #40）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-seed-'));
  fs.writeFileSync(
    path.join(dir, 'config.yaml'),
    'broker:\n  mock_csv_path: "./data/mock_kline.csv"\n',
    'utf8',
  );
  const created1 = seedSmokeCsvFixtures(dir);
  assert.deepEqual(created1, ['./data/mock_kline.csv']);
  assert.ok(fs.existsSync(path.join(dir, 'data/mock_kline.csv')));
  const created2 = seedSmokeCsvFixtures(dir);
  assert.deepEqual(created2, []);
});

// ADR-0009：schema 感知种子（禁止把期货 K 线塞进 todo 任务）
test('inferCsvColumns 从 row["x"] / row.get("x") 推断列（按序去重）', () => {
  const py = `
title = row["title"].strip()
priority = int(row["priority"])
status = row.get("status", "")
again = row["title"]
`;
  assert.deepEqual(inferCsvColumns(py), ['title', 'priority', 'status']);
});

test('inferFirstEnumValue 取首个字符串集合首值', () => {
  const py = 'VALID_STATUSES = {"todo", "in_progress", "done", "cancelled"}';
  assert.equal(inferFirstEnumValue(py), 'todo');
});

test('buildSeedCsv 用推断列 + 启发式值（priority 1..5，status 用枚举）', () => {
  const py = 'VALID_STATUSES = {"todo", "in_progress", "done"}';
  const csv = buildSeedCsv(['title', 'priority', 'status'], py, 2);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'title,priority,status');
  assert.equal(lines.length, 3);
  const [t, p, s] = lines[1].split(',');
  assert.ok(t.length > 0);
  const pn = Number(p);
  assert.ok(pn >= 1 && pn <= 5, `priority ${p} 应在 1..5`);
  assert.equal(s, 'todo');
});

test('seedSmokeCsvFixtures：todo 任务种子匹配任务字段（非期货列）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-seed-todo-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'csv_path: "tasks.csv"\n', 'utf8')
  fs.mkdirSync(path.join(dir, 'pipeline'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'pipeline/__init__.py'),
    'VALID_STATUSES = {"todo", "in_progress", "done", "cancelled"}\n' +
      'def run(row):\n    return row["title"], int(row["priority"]), row.get("status", "")\n',
    'utf8',
  )
  const created = seedSmokeCsvFixtures(dir);
  assert.deepEqual(created, ['tasks.csv']);
  const seeded = fs.readFileSync(path.join(dir, 'tasks.csv'), 'utf8');
  const header = seeded.trim().split('\n')[0];
  assert.equal(header, 'title,priority,status');
  assert.ok(!/timestamp|open,high|volume/.test(seeded), '不应是期货 K 线种子');
});
