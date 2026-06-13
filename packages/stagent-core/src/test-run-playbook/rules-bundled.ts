import { commandBundlesInstallAndTest } from '../TestRunCommandNormalize';
import type { TestRunFailureRule } from './rules';

export const bundledRules: TestRunFailureRule[] = [
  {
    code: 'bundled-install-test-timeout',
    match: (_blob, input) => !!(input.timedOut && commandBundlesInstallAndTest(input.command)),
    build: () => ({
      code: 'bundled-install-test-timeout',
      title: '测试阶段超时（可能卡在依赖安装）',
      summary:
        '同一条 command 仍串联 npm install 与 jest/test，安装占满超时预算。M38.2 会在 normalize 自动拆分；旧计划请手动拆阶段或开启 stagent.execution.splitTestRunBundledCommands。',
      steps: [
        '将 npm install / npm ci 移到独立 stage_deps_install_* 或 stage_init_*',
        'test_run 只保留 npx jest / npm test',
        '确认 stagent.execution.splitTestRunBundledCommands 为 true 后重新生成工作流',
      ],
    }),
  },
  {
    code: 'install-and-test-timeout',
    match: (_blob, input) =>
      !!(
        input.timedOut &&
        /\bnpm\s+(install|ci)\b/i.test(input.command) &&
        /\b(jest|npm\s+test|vitest|pytest)\b/i.test(input.command)
      ),
    build: () => ({
      code: 'install-and-test-timeout',
      title: '安装 + 测试同阶段超时',
      summary: '命令同时包含依赖安装与测试，易在 install 阶段耗尽超时。',
      steps: [
        '拆成「仅 install」与「仅 test」两个阶段（见 M38.2）',
        '安装阶段可单独重试；测试失败时 stderr 更易定位',
      ],
    }),
  },
  {
    code: 'npm-install-failed-in-test',
    match: (blob, input) =>
      /npm ERR!|EACCES|ECONNRESET|ETIMEDOUT|network/i.test(blob) &&
      /\bnpm\s+(install|ci)\b/i.test(input.command),
    build: () => ({
      code: 'npm-install-failed-in-test',
      title: '测试阶段内 npm 安装失败',
      summary: '网络/registry/权限导致 install 失败，不应与 test 混在同一 command。',
      steps: [
        '将 npm install 移到独立 stage_deps_install_*（M38.2）',
        '检查 registry 镜像、代理与 node_modules 权限',
        '安装成功后再单独跑 jest/pytest',
      ],
    }),
  },
];
