import { contractWarningMsg } from './l10n/lintMsg';
import { formatContractWarningColon } from './lint/ContractWarningFormat';
import type { ProjectFile } from './CrossFileKeyContractLint';
import { levenshtein } from './KeyNameMatching';

/**
 * M28：样例表头 ↔ reader 列名映射契约 lint（运行期，test_run 前 / run_end 前）。
 *
 * 背景：`create_sample.py` 用列表字面量写 Excel 表头（如 `["ASIN","TK SKU","目标价","库存"]`），
 * 而 `reader.py` 用一份 COLUMN_MAPPING（精确匹配）把显示表头转内部键。两者各自臆造映射时会漂移：
 * 例如样例写 `TK SKU`/`目标价`，reader 只认 `TK_SKU`/`目标价格` → reader 精确匹配判定「缺必需列」，集成测试整体失败。
 *
 * `CrossFileKeyContractLint` 只抽取 ASCII 标识符键（`'tk_sku':` / `.get('sku')`），对**带空格/中文的 Excel 表头**
 * 完全是盲区。本 lint 专门补这一类：抽取样例表头 + reader 识别列名集，对「未精确识别但存在 near-miss」的表头告警。
 *
 * 纯函数，warning-only（token：`contract:sample-header-unmapped:...`）。
 */

const STRING_LITERAL = /['"]([^'"\n]{1,40})['"]/g;

function extractStringLiterals(segment: string): string[] {
  const out: string[] = [];
  STRING_LITERAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRING_LITERAL.exec(segment)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** 抽取 Excel 表头行：优先 `headers/columns = [...]` 变量，其次首个 `.append([... 全字符串 ...])`。 */
export function extractExcelHeaderRow(content: string): string[] {
  const varMatch = content.match(/\b(?:headers?|columns?|cols|header_row|col_names)\s*=\s*\[([^\]]*)\]/i);
  if (varMatch) {
    const items = extractStringLiterals(varMatch[1]);
    if (items.length >= 2) {
      return items;
    }
  }
  const appendRe = /\.append\(\s*\[([^\]]*)\]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = appendRe.exec(content)) !== null) {
    const items = extractStringLiterals(m[1]);
    // 表头启发式：列表元素均为非数字字符串字面量且 ≥2 列
    if (items.length >= 2 && !/^[\s\d.,]*$/.test(m[1].replace(STRING_LITERAL, ''))) {
      return items;
    }
  }
  return [];
}

/** 抽取 reader 能识别的列名集合：dict 字面量中冒号左侧的字符串键（含空格/中文）。 */
export function extractRecognizedColumnKeys(content: string): Set<string> {
  const out = new Set<string>();
  const re = /['"]([^'"\n]{1,40})['"]\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const k = m[1].trim();
    if (k) {
      out.add(k);
    }
  }
  return out;
}

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./]+/g, '');
}

/** header 与 candidate 是否 near-miss（精确相等不算 miss；归一化后相等 / 子串 / 编辑距离 ≤2 算 miss）。 */
export function isHeaderNearMiss(header: string, candidate: string): boolean {
  if (header === candidate) {
    return false;
  }
  const na = normalizeHeader(header);
  const nb = normalizeHeader(candidate);
  if (!na || !nb) {
    return false;
  }
  if (na === nb) {
    return true; // 'TK SKU' vs 'TK_SKU'
  }
  if (na.length >= 2 && nb.length >= 2 && (na.includes(nb) || nb.includes(na))) {
    return true; // '目标价' vs '目标价格'
  }
  if (Math.min(na.length, nb.length) >= 3 && levenshtein(na, nb) <= 2) {
    return true;
  }
  return false;
}

/**
 * 仅对「样例表头未被 reader 精确识别、但存在 near-miss 识别列名」告警（高精度，低误报）。
 * 完全陌生（无任何 near-miss）的表头视为 reader 不关心的额外列，跳过。
 */
export function lintSampleReaderHeaderContract(files: ProjectFile[]): string[] {
  const sample = files.find((f) => /create_sample\.py$/i.test(f.path));
  const reader = files.find((f) => /(^|\/)reader\.py$/i.test(f.path));
  if (!sample || !reader) {
    return [];
  }
  const headers = extractExcelHeaderRow(sample.content);
  if (headers.length === 0) {
    return [];
  }
  const recognized = extractRecognizedColumnKeys(reader.content);
  if (recognized.size === 0) {
    return [];
  }
  const warnings: string[] = [];
  for (const h of headers) {
    const header = h.trim();
    if (!header || recognized.has(header)) {
      continue;
    }
    let nearest: string | undefined;
    for (const k of recognized) {
      if (isHeaderNearMiss(header, k)) {
        nearest = k;
        break;
      }
    }
    if (nearest) {
      warnings.push(
        formatContractWarningColon(
          'sample-header-unmapped',
          reader.path,
          contractWarningMsg('sampleHeaderUnmapped', header, nearest),
        ),
      );
    }
  }
  return warnings;
}
