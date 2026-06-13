import type { TestRunFailureRule } from './rules';

export const testRules: TestRunFailureRule[] = [
  {
    code: 'jest-ts-transform-missing',
    match: (blob) =>
      /SyntaxError:\s*Unexpected token|Jest encountered an unexpected token|Support for the experimental syntax|'import' and 'export' may appear only with 'sourceType: module'/i.test(
        blob,
      ) &&
      (/\.tsx?\b|\.jsx\b|typescript|import\s+type|import\s+\{|export\s+(default\s+)?(function|class|const)/i.test(
        blob,
      ) ||
        /\.ts['"`)]/i.test(blob)),
    build: () => ({
      code: 'jest-ts-transform-missing',
      title: 'Jest 无法解析 TypeScript/JSX',
      summary:
        '常见于缺少 jest.config / babel.config 或 ts-jest、jest-expo preset。M39.1 生成期与 M38.1 运行期 preflight 会拦截缺配置；若仍出现，说明配置未落盘或与栈不匹配。',
      steps: [
        '添加 jest.config.js（非 Expo：ts-jest 或 preset；Expo：preset: jest-expo + babel.config.js）',
        '确认 babel-preset-expo / @types/jest 已在 package.json',
        '本地复现：在工作区根目录只跑 test_run 里的 jest 命令（skills diagnose）',
        '重新生成工作流，确保 test_run 前有 stage_impl_jest_config 等阶段',
      ],
    }),
  },
  {
    code: 'jest-config-or-expo-preset-missing',
    match: (blob) =>
      /Could not find a config file|No configuration file|Cannot find module ['"]jest-expo['"]|Preset .*jest-expo.* not found|Module ['"]jest-expo['"]/i.test(
        blob,
      ),
    build: () => ({
      code: 'jest-config-or-expo-preset-missing',
      title: 'Jest 配置或 jest-expo preset 缺失',
      summary: 'Jest 找不到配置文件或 Expo preset 未安装。',
      steps: [
        '创建 jest.config.js 并设置 preset: "jest-expo"（Expo 项目）',
        '运行 npm install --save-dev jest-expo jest babel-jest @types/jest',
        'Expo 栈同时需要 babel.config.js（babel-preset-expo）',
      ],
    }),
  },
  {
    code: 'babel-missing-for-jest',
    match: (blob) =>
      /Cannot find module ['"]@babel|babel-jest|Requires Babel|You must install babel/i.test(blob),
    build: () => ({
      code: 'babel-missing-for-jest',
      title: 'Jest 需要 Babel 但未配置',
      summary: 'React Native / Expo 测试通常需要 babel-jest 与 babel.config.js。',
      steps: [
        '添加 babel.config.js（presets: ["babel-preset-expo"] 或项目等价项）',
        'jest.config.js 中确认 transform 使用 babel-jest',
        '安装缺失的 @babel/* 或 babel-preset-expo 依赖',
      ],
    }),
  },
  {
    code: 'jest-config-file-missing',
    match: (blob) => /ENOENT.*jest\.config|jest\.config\.[a-z]+ not found/i.test(blob),
    build: () => ({
      code: 'jest-config-file-missing',
      title: '缺少 jest.config 文件',
      summary: 'Jest 启动时未找到配置文件。',
      steps: [
        '在工作区根目录（或 package.json 所在目录）添加 jest.config.js',
        '若计划已有 stage_impl_jest_config，确认该阶段已成功执行并落盘',
      ],
    }),
  },
];
