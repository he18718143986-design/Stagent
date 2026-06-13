/* ------------------------------------------------------------------ */
/*  SessionDebugLog.ts — 会话级调试日志（fallback）                     */
/*                                                                     */
/*  方案 A 后，有预执行/执行实例时 LLM 与 debug 事件统一写入             */
/*  taskDir/.wf-debug.log。本模块仅在尚无实例时作为 fallback，落到         */
/*  globalStorageDir/.session-debug.log。                               */
/*                                                                     */
/*  纯函数 + fs，无 vscode/electron 依赖，便于 node:test 单测。          */
/* ------------------------------------------------------------------ */

import * as fs from 'fs';
import * as path from 'path';
import { sanitizeForLog } from './WorkflowLogging';

/** 会话级调试日志文件名（位于 globalStorageDir 下）。 */
export const SESSION_DEBUG_FILENAME = '.session-debug.log';

/** 该会话日志文件的完整路径。 */
export function sessionDebugLogPath(globalStorageDir: string): string {
  return path.join(globalStorageDir, SESSION_DEBUG_FILENAME);
}

/**
 * 格式化一行会话日志：`<ISO> [session] [purpose] [event] <json>`。
 * purpose 即 LLM 调用的 traceStageId（task-polish / clarify-questions /
 * workflow-gen / …）。payload 经 sanitizeForLog 脱敏 + 截断。
 */
export function formatSessionLogLine(purpose: string, event: string, payload?: unknown): string {
  const safe = payload === undefined ? '' : JSON.stringify(sanitizeForLog(payload));
  return `${new Date().toISOString()} [session] [${purpose}] [${event}] ${safe}`;
}

/** 追加一行到会话日志（目录不存在则创建）。调用方应自行兜底异常。 */
export function appendSessionLogLine(globalStorageDir: string, line: string): void {
  fs.mkdirSync(globalStorageDir, { recursive: true });
  fs.appendFileSync(sessionDebugLogPath(globalStorageDir), `${line}\n`, 'utf-8');
}
