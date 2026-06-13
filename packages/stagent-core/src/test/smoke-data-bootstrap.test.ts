import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractCsvPathsFromYaml,
  seedSmokeCsvFixtures,
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
