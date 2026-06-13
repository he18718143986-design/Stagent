import * as fs from 'fs';
import * as path from 'path';
import type { Stage, WorkflowDefinition } from '../src/WorkflowDefinition';
import { scoreStatically } from '../src/OutputQualityScorer';

interface FixtureMeta {
  stageKind: 'decision' | 'impl' | 'other';
  minOverall?: number;
  maxOverall?: number;
}

interface CliOptions {
  fixturesDir?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--fixtures-dir') {
      opts.fixturesDir = argv[i + 1];
      i += 1;
    }
  }
  return opts;
}

function collectFixtureBasenames(fixturesDir: string): string[] {
  const absDir = path.isAbsolute(fixturesDir) ? fixturesDir : path.join(process.cwd(), fixturesDir);
  return fs
    .readdirSync(absDir)
    .filter((name) => name.endsWith('.meta.json'))
    .map((name) => name.replace(/\.meta\.json$/, ''))
    .sort();
}

function readFixtureContent(fixturesDir: string, base: string): string {
  const absDir = path.isAbsolute(fixturesDir) ? fixturesDir : path.join(process.cwd(), fixturesDir);
  for (const ext of ['.md', '.txt', '.ts']) {
    const p = path.join(absDir, `${base}${ext}`);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  throw new Error(`missing content file for fixture ${base}`);
}

function stageForKind(kind: FixtureMeta['stageKind']): Stage {
  if (kind === 'decision') {
    return {
      id: 'stage_decide_fixture',
      title: 'fixture decision',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(40) },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'decisionRecord', format: 'markdown' }],
      pauseAfter: true,
      isDecisionStage: true,
    };
  }
  if (kind === 'impl') {
    return {
      id: 'stage_impl_fixture',
      title: 'fixture impl',
      tool: 'llm-text',
      toolConfig: { type: 'llm-text', systemPrompt: 'x'.repeat(40) },
      input: { sources: [], mergeStrategy: 'concat' },
      outputs: [{ key: 'implCode', format: 'markdown' }],
      pauseAfter: false,
    };
  }
  return {
    id: 'stage_other_fixture',
    title: 'fixture',
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [{ key: 'out', format: 'text' }],
    pauseAfter: false,
  };
}

const BASE_WF: WorkflowDefinition = {
  id: 'wf-fixture',
  version: '2.0',
  meta: {
    title: 'fixture',
    taskType: 'software',
    userInput: 'u',
    createdAt: new Date().toISOString(),
  },
  stages: [],
};

function runFixture(fixturesDir: string, base: string): boolean {
  const absDir = path.isAbsolute(fixturesDir) ? fixturesDir : path.join(process.cwd(), fixturesDir);
  const meta = JSON.parse(
    fs.readFileSync(path.join(absDir, `${base}.meta.json`), 'utf-8'),
  ) as FixtureMeta;
  const content = readFixtureContent(fixturesDir, base);
  const stage = stageForKind(meta.stageKind);
  const score = scoreStatically(stage, content, BASE_WF);
  let ok = true;
  if (meta.minOverall !== undefined && score.overall < meta.minOverall) {
    console.log(`- FAIL ${base}: overall ${score.overall} < min ${meta.minOverall}`);
    ok = false;
  }
  if (meta.maxOverall !== undefined && score.overall > meta.maxOverall) {
    console.log(`- FAIL ${base}: overall ${score.overall} > max ${meta.maxOverall}`);
    ok = false;
  }
  if (ok) {
    console.log(`- PASS ${base}: overall=${score.overall} recommendation=${score.recommendation}`);
  }
  return ok;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const fixturesDir = opts.fixturesDir ?? 'scripts/fixtures/confidence';
  const bases = collectFixtureBasenames(fixturesDir);
  if (bases.length === 0) {
    console.error(`No fixtures in ${fixturesDir}`);
    process.exit(1);
  }
  console.log(`\n[verify:quality-scorer] ${fixturesDir} (${bases.length} fixtures)`);
  let allOk = true;
  for (const base of bases) {
    allOk = runFixture(fixturesDir, base) && allOk;
  }
  console.log(allOk ? '\n✅ verify:quality-scorer PASS' : '\n❌ verify:quality-scorer FAIL');
  process.exit(allOk ? 0 : 1);
}

main();
