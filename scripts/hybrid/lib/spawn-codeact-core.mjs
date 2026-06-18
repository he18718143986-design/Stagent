/**
 * Spawn stagent-codeact with optional NDJSON event capture.
 */
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '../../..')
export const VENV_CLI = path.join(REPO_ROOT, 'packages/codeact-runner/.venv/bin/stagent-codeact')

/**
 * @param {{
 *   bundle: string,
 *   workspace: string,
 *   fixPromptPath?: string|null,
 *   eventsOut?: string|null,
 *   inheritStdio?: boolean,
 * }} opts
 */
export function spawnCodeAct(opts) {
  const bundle = path.resolve(opts.bundle)
  const workspace = path.resolve(opts.workspace)

  if (!fs.existsSync(VENV_CLI)) {
    return { exitCode: 1, error: 'CodeAct venv missing. Run: npm run codeact:install' }
  }

  const args = ['run', '--bundle', bundle, '--workspace', workspace]
  if (opts.fixPromptPath) {
    const text = fs.readFileSync(opts.fixPromptPath, 'utf8')
    args.push('--fix-prompt', text)
  }

  const captureEvents = Boolean(opts.eventsOut)
  const env = {
    ...process.env,
    OPENHANDS_SUPPRESS_BANNER: process.env.OPENHANDS_SUPPRESS_BANNER ?? '1',
  }

  const r = spawnSync(VENV_CLI, args, {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    stdio: captureEvents ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  })

  if (captureEvents && opts.eventsOut && r.stdout) {
    fs.mkdirSync(path.dirname(opts.eventsOut), { recursive: true })
    fs.writeFileSync(opts.eventsOut, r.stdout, 'utf8')
  }

  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}
