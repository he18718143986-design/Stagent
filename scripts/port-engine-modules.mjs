#!/usr/bin/env node
/**
 * port-engine-modules.mjs — 从 stagent_vscode 批量移植引擎子目录到 @stagent/core。
 *
 * 用法:
 *   node scripts/port-engine-modules.mjs --dirs path-router,contract-infra
 *   node scripts/port-engine-modules.mjs --all-missing
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const VSCODE_SRC = path.join(REPO_ROOT, 'stagent_vscode/src');
const CORE_SRC = path.join(REPO_ROOT, 'autoAI/packages/stagent-core/src');

const SKIP_DIRS = new Set(['webview', 'test', 'sidebar', 'adapters', 'generated', 'l10n']);

function listVscodeEngineDirs() {
  return fs
    .readdirSync(VSCODE_SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();
}

function copyDir(srcDir, destDir, opts = {}) {
  const { dryRun = false, overwrite = false } = opts;
  let copied = 0;
  let skipped = 0;

  function walk(rel = '') {
    const src = path.join(srcDir, rel);
    const dest = path.join(destDir, rel);
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!dryRun) fs.mkdirSync(path.join(destDir, relPath), { recursive: true });
        walk(relPath);
      } else if (ent.isFile() && ent.name.endsWith('.ts')) {
        const destFile = path.join(destDir, relPath);
        if (fs.existsSync(destFile) && !overwrite) {
          skipped++;
          continue;
        }
        if (!dryRun) {
          fs.mkdirSync(path.dirname(destFile), { recursive: true });
          fs.copyFileSync(path.join(srcDir, relPath), destFile);
        }
        copied++;
      }
    }
  }

  walk();
  return { copied, skipped };
}

function importsVscode(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return /from\s+['"]vscode['"]|require\s*\(\s*['"]vscode['"]\)/.test(content);
}

function scanVscodeImports(dir) {
  const files = [];
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts') && importsVscode(p)) files.push(path.relative(CORE_SRC, p));
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return files;
}

function main() {
  const args = process.argv.slice(2);
  const allMissing = args.includes('--all-missing');
  const overwrite = args.includes('--overwrite');
  const dryRun = args.includes('--dry-run');

  let dirs = [];
  const dirsIdx = args.indexOf('--dirs');
  if (dirsIdx >= 0 && args[dirsIdx + 1]) {
    dirs = args[dirsIdx + 1].split(',').map((s) => s.trim());
  } else if (allMissing) {
    const vscodeDirs = listVscodeEngineDirs();
    dirs = vscodeDirs.filter((d) => !fs.existsSync(path.join(CORE_SRC, d)));
  } else {
    console.error('Usage: --dirs a,b,c | --all-missing [--overwrite] [--dry-run]');
    process.exit(1);
  }

  console.log(`Porting ${dirs.length} directories (dryRun=${dryRun}, overwrite=${overwrite})`);
  let totalCopied = 0;
  let totalSkipped = 0;
  const vscodeImportFiles = [];

  for (const dir of dirs) {
    const src = path.join(VSCODE_SRC, dir);
    const dest = path.join(CORE_SRC, dir);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP missing vscode dir: ${dir}`);
      continue;
    }
    const { copied, skipped } = copyDir(src, dest, { dryRun, overwrite });
    totalCopied += copied;
    totalSkipped += skipped;
    console.log(`  ${dir}: copied=${copied} skipped=${skipped}`);
    if (!dryRun) {
      vscodeImportFiles.push(...scanVscodeImports(dest));
    }
  }

  console.log(`\nTotal: copied=${totalCopied} skipped=${totalSkipped}`);
  if (vscodeImportFiles.length > 0) {
    console.log(`\nFiles with vscode imports (${vscodeImportFiles.length}):`);
    for (const f of vscodeImportFiles.slice(0, 40)) console.log(`  ${f}`);
    if (vscodeImportFiles.length > 40) console.log(`  ... and ${vscodeImportFiles.length - 40} more`);
  }
}

main();
