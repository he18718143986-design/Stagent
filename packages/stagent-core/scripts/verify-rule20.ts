import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowDefinition } from '../src/WorkflowDefinition';
import { verifyRule20 } from '../src/Rule20Verify';
import type { VerifyResult } from '../src/Rule20Verify';

interface CliOptions {
  fromFile?: string;
  fixturesDir?: string;
}

function readWorkflowFromArg(fileArg?: string): WorkflowDefinition | undefined {
  if (!fileArg) {
    return undefined;
  }
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  const raw = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(raw) as WorkflowDefinition;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from-file') {
      opts.fromFile = argv[i + 1];
      i += 1;
    } else if (a === '--fixtures-dir') {
      opts.fixturesDir = argv[i + 1];
      i += 1;
    } else if (!a.startsWith('--') && !opts.fromFile) {
      // backward compatible: allow `ts-node verify-rule20.ts path/to/workflow.json`
      opts.fromFile = a;
    }
  }
  return opts;
}

function collectFixtureFiles(fixturesDir: string): string[] {
  const absDir = path.isAbsolute(fixturesDir) ? fixturesDir : path.join(process.cwd(), fixturesDir);
  if (!fs.existsSync(absDir)) {
    return [];
  }
  return fs
    .readdirSync(absDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(absDir, name))
    .sort();
}

function printResult(label: string, result: VerifyResult): void {
  console.log(`\n[${label}] ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  if (result.violations.length > 0) {
    console.log('Violations:');
    result.violations.forEach((v) => {
      console.log(`- (${v.type}) ${v.stageId}: ${v.message}`);
    });
  }
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((w) => {
      console.log(`- (${w.type}) ${w.stageId}: ${w.message}`);
    });
  }
  if (result.violations.length === 0 && result.warnings.length === 0) {
    console.log('- No issues');
  }
}

function buildMockWorkflow(): WorkflowDefinition {
  return {
    id: 'wf_mock',
    version: '2.0',
    meta: {
      title: 'mock',
      taskType: 'software',
      userInput: 'mock',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_decide_parser',
        title: 'decide parser',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: { sources: [{ type: 'user-input', label: '需求' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'decisionRecord', format: 'markdown' }],
        pauseAfter: true,
        isDecisionStage: true,
      },
      {
        id: 'stage_impl_parser',
        title: 'impl parser',
        tool: 'llm-text',
        toolConfig: { type: 'llm-text', systemPrompt: 'x' },
        input: {
          sources: [{ type: 'stage-output', stageId: 'stage_decide_parser', outputKey: 'decisionRecord', label: '已确认的决策清单' }],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'code', format: 'text' }],
        pauseAfter: false,
      },
    ],
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.fixturesDir) {
    const files = collectFixtureFiles(opts.fixturesDir);
    if (files.length === 0) {
      console.error(`No fixture json files found in: ${opts.fixturesDir}`);
      process.exitCode = 1;
      return;
    }
    let hasFailure = false;
    for (const file of files) {
      const workflow = readWorkflowFromArg(file);
      if (!workflow) {
        continue;
      }
      const result = verifyRule20(workflow);
      const filename = path.basename(file);
      const expectFail = filename.startsWith('fail-');
      printResult(filename, result);
      if (expectFail) {
        if (result.passed) {
          console.error(`Expected FAIL but got PASS: ${filename}`);
          hasFailure = true;
        }
        continue;
      }
      if (!result.passed) {
        hasFailure = true;
      }
    }
    if (hasFailure) {
      process.exitCode = 1;
    }
    return;
  }

  const workflow = readWorkflowFromArg(opts.fromFile) ?? buildMockWorkflow();
  const result = verifyRule20(workflow);
  printResult(opts.fromFile ?? 'mock-workflow', result);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
