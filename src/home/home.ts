/**
 * ~/.stagent：仓库之外的本地数据（规格 §3、§4.3）。
 *
 *   projects/<projectId>/head        链头哈希（防篡改锚点，M6）
 *   projects/<projectId>/usage.jsonl Claude Code 用量与费用（§6 费用上限，内部数据，不进事件链）
 *   library/*.md                     个人通用库（§10）
 *   metrics.jsonl                    本地埋点（§14）
 *
 * 测试与多实例演示可用环境变量 STAGENT_HOME 指向别处。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export function stagentHome(): string {
  return process.env.STAGENT_HOME || join(homedir(), '.stagent');
}

export function projectHomeDir(projectId: string): string {
  return join(stagentHome(), 'projects', safeSegment(projectId));
}

export function libraryDir(): string {
  return join(stagentHome(), 'library');
}

export function metricsPath(): string {
  return join(stagentHome(), 'metrics.jsonl');
}

function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
}
