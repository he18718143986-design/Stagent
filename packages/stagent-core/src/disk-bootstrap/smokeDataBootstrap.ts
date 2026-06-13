import * as fs from 'fs';
import * as path from 'path';

/** 最小 OHLCV CSV，供 smoke 前种子数据（T4 Run #40：mock_csv_path 缺失 → smoke exit 1）。 */
export const MINIMAL_KLINE_CSV = `timestamp,open,high,low,close,volume
2023-01-02 09:30:00,4000,4010,3990,4005,1000
2023-01-02 09:31:00,4005,4015,3995,4010,1100
`;

/** 从 config.yaml 文本抽取相对/绝对 .csv 路径引用。 */
export function extractCsvPathsFromYaml(yamlText: string): string[] {
  const paths = new Set<string>();
  const re = /['"]?(\.?\/?[\w./-]+\.csv)['"]?/gi;
  for (const m of yamlText.matchAll(re)) {
    const p = m[1]?.trim();
    if (p && !/^https?:/i.test(p)) {
      paths.add(p.replace(/\\/g, '/'));
    }
  }
  return [...paths];
}

/**
 * smoke 前：为 config.yaml 引用的缺失 CSV 写入最小 fixture（幂等）。
 * @returns 新创建文件的相对路径列表
 */
export function seedSmokeCsvFixtures(workspaceRoot: string, yamlRelPath = 'config.yaml'): string[] {
  const yamlPath = path.join(workspaceRoot, yamlRelPath);
  if (!fs.existsSync(yamlPath)) {
    return [];
  }
  const yaml = fs.readFileSync(yamlPath, 'utf8');
  const created: string[] = [];
  for (const rel of extractCsvPathsFromYaml(yaml)) {
    const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
    if (fs.existsSync(abs)) {
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, MINIMAL_KLINE_CSV, 'utf8');
    created.push(rel);
  }
  return created;
}
