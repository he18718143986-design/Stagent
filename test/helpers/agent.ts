import type { StagentService } from '../../src/server/service.js';

/** 等 AI 任务（含它触发的回归）全部结束。 */
export async function waitAgent(svc: StagentService): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (svc.agentTask) await svc.agentTask.promise;
    await svc.waitForRun();
    await svc.waitForBackground();
    if (!svc.agentTask && !svc.running) return;
  }
  throw new Error('AI 任务没有结束');
}

export const REPORT = (exampleIds: string[] = []) =>
  `## 改了什么\n按描述修改了代码\n\n## 取舍\n无\n\n## 例子\n${exampleIds.map((id) => `- ${id}: 已实现`).join('\n') || '无'}\n`;
