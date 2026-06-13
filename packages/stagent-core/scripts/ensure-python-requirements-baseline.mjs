#!/usr/bin/env node
/**
 * 在 stage_venv_pip_install 前确保 requirements.txt 含量化/TDD 基线依赖。
 * 合并已有行（不覆盖 pin），缺省追加 pytest / numpy / pandas。
 *
 * 用法：node ensure-python-requirements-baseline.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASELINE = ['pytest', 'numpy', 'pandas'];
const REQ = 'requirements.txt';

function packageName(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }
  return trimmed.split(/[=<>!\[~;\s]/)[0].trim().toLowerCase();
}

function main() {
  const cwd = process.cwd();
  const reqPath = path.join(cwd, REQ);
  const existing = fs.existsSync(reqPath)
    ? fs.readFileSync(reqPath, 'utf8').split(/\r?\n/)
    : [];
  const lines = existing.map((l) => l.trimEnd()).filter((l, i, arr) => {
    if (i === arr.length - 1 && l === '') return false;
    return true;
  });
  const present = new Set(lines.map(packageName).filter(Boolean));
  const added = [];
  for (const pkg of BASELINE) {
    if (!present.has(pkg)) {
      lines.push(pkg);
      added.push(pkg);
    }
  }
  const body = lines.length ? `${lines.join('\n')}\n` : `${BASELINE.join('\n')}\n`;
  fs.writeFileSync(reqPath, body, 'utf8');
  console.log(
    added.length
      ? `ensure-python-requirements-baseline: appended ${added.join(', ')} → ${REQ}`
      : `ensure-python-requirements-baseline: ${REQ} already has baseline (${BASELINE.join(', ')})`,
  );
}

main();
