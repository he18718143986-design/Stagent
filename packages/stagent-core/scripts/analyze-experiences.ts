#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
import { WorkflowExperienceStore } from '../src/WorkflowExperienceStore';
import {
  analyzeFailurePatterns,
  formatFailureAnalysisMarkdown,
} from '../src/FailurePatternAnalyzer';

interface CliOptions {
  workspace?: string;
  topFailures?: number;
  format?: 'markdown' | 'json';
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { format: 'markdown', topFailures: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--workspace') {
      opts.workspace = argv[i + 1];
      i += 1;
    } else if (a === '--top-failures') {
      opts.topFailures = Number(argv[i + 1]);
      i += 1;
    } else if (a === '--format') {
      opts.format = argv[i + 1] as 'markdown' | 'json';
      i += 1;
    }
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const workspace = path.resolve(opts.workspace ?? process.cwd());
  const storePath = path.join(workspace, '.stagent', 'experiences.jsonl');
  if (!fs.existsSync(storePath)) {
    console.error(`No experiences at ${storePath}`);
    process.exit(1);
  }
  const store = new WorkflowExperienceStore(storePath);
  const experiences = store.readAll();
  const report = analyzeFailurePatterns(experiences);
  const kindCount = new Set(report.patterns.map((p) => p.kind)).size;

  if (opts.format === 'json') {
    console.log(JSON.stringify({ ...report, actionableKindCount: kindCount }, null, 2));
  } else {
    console.log(formatFailureAnalysisMarkdown(report));
    console.log(`\nActionable pattern kinds: ${kindCount}`);
  }

  if (kindCount < 3 && experiences.length >= 3) {
    console.warn('⚠️ Fewer than 3 actionable pattern kinds; add more diverse failure fixtures.');
  }

  process.exit(0);
}

main();
