import type { TestRunFailureRule } from './rules';

export const importRules: TestRunFailureRule[] = [
  {
    code: 'jest-module-not-found',
    match: (blob) =>
      /Cannot find module ['"]/i.test(blob) && /\b(jest|vitest|test suite failed to run)/i.test(blob),
    build: (blob) => {
      const modMatch = /Cannot find module ['"]([^'"]+)['"]/.exec(blob);
      const mod = modMatch?.[1] ?? '（未知模块）';
      return {
        code: 'jest-module-not-found',
        title: `Jest 找不到模块：${mod}`,
        summary: '可能是依赖未安装、路径 alias 未配置，或 impl/test 引用路径不一致。',
        steps: [
          '确认 npm install 已在独立阶段完成且 exitCode=0',
          '检查 jest.config.js 的 moduleNameMapper / roots',
          '对比 impl 与 test 的 import 路径是否与 DecisionRecord 一致',
        ],
      };
    },
  },
  {
    code: 'firebase-sdk-mismatch',
    match: (blob) =>
      /Cannot find module ['"]@react-native-firebase|Cannot find module ['"]firebase\/app['"]|Cannot find module ['"]@firebase/i.test(
        blob,
      ),
    build: () => ({
      code: 'firebase-sdk-mismatch',
      title: 'Firebase / RN SDK 与测试 mock 不一致',
      summary:
        'Web Firebase SDK（firebase/app）与 React Native（@react-native-firebase）不可混用；DecisionRecord 选型须与 impl/test mock 一致（M39.2 sdkPathContractLint 可提前检出）。',
      steps: [
        '核对 DecisionRecord 中的 SDK 选型',
        '测试 mock 路径与 impl import 对齐（同一 SDK 族）',
        '必要时在 jest.config.js 增加 moduleNameMapper',
      ],
    }),
  },
  {
    code: 'pytest-path-missing',
    match: (blob, input) =>
      /\bpytest\b/i.test(input.command) &&
      /No module named/i.test(blob) &&
      !/cannot import name/i.test(blob),
    build: (blob) => {
      const modMatch = /No module named ['"]?([^'"\s]+)/i.exec(blob);
      return {
        code: 'pytest-path-missing',
        title: `pytest 路径缺失${modMatch?.[1] ? `：${modMatch[1]}` : ''}`,
        summary: '模块文件存在但不在 Python 搜索路径（flat layout 常见）。',
        steps: [
          '添加 conftest.py（sys.path.insert 项目根）或执行前设置 PYTHONPATH=.',
          '确认 tests/ 与被测 .py 的目录布局与 DecisionRecord 一致',
          '本地复现：cd 到相同目录运行同一条 pytest 命令',
        ],
      };
    },
  },
  {
    code: 'pytest-symbol-missing',
    match: (blob, input) =>
      /\bpytest\b/i.test(input.command) &&
      /cannot import name/i.test(blob) &&
      !/site-packages/i.test(blob),
    build: (blob) => {
      const symMatch = /cannot import name ['"]?([^'"\s]+)/i.exec(blob);
      return {
        code: 'pytest-symbol-missing',
        title: `pytest 符号缺失${symMatch?.[1] ? `：${symMatch[1]}` : ''}`,
        summary: '模块可找到但导出符号与 test import 不一致。',
        steps: [
          '对比 tests/ 的 from <mod> import <name> 与 impl 顶层 class/def/__all__',
          '对齐命名或补充导出（__all__ / re-export）',
          '检查 DecisionRecord 中的 API 命名是否与 impl 一致',
        ],
      };
    },
  },
  {
    code: 'pytest-third-party-api',
    match: (blob, input) =>
      /\bpytest\b/i.test(input.command) &&
      /cannot import name/i.test(blob) &&
      /site-packages/i.test(blob),
    build: (blob) => {
      const symMatch = /cannot import name ['"]?([^'"\s]+)/i.exec(blob);
      return {
        code: 'pytest-third-party-api',
        title: `第三方 API 幻觉${symMatch?.[1] ? `：${symMatch[1]}` : ''}`,
        summary: 'requirements 中的包已安装，但 import 的符号在该版本不存在。',
        steps: [
          '查阅该包官方文档核实入口类/函数（勿臆造 MdApi 等名称）',
          '更新 impl 的 from <pkg> import … 与 venv import_check 命令',
          '在 DecisionRecord 写明「包@版本 + 核实过的入口符号」',
        ],
      };
    },
  },
  {
    code: 'pytest-import-error',
    match: (blob, input) =>
      /\bpytest\b/i.test(input.command) && /ModuleNotFoundError|ImportError|No module named/i.test(blob),
    build: (blob) => {
      const modMatch = /No module named ['"]?([^'"\s]+)/i.exec(blob);
      return {
        code: 'pytest-import-error',
        title: `pytest 导入失败${modMatch?.[1] ? `：${modMatch[1]}` : ''}`,
        summary: 'Python 测试无法 import 被测模块或依赖。',
        steps: [
          '确认 pip install / venv 已在独立阶段完成',
          'PYTHONPATH 或包结构是否与 impl 布局一致',
          '本地复现：cd 到相同目录运行同一条 pytest 命令',
        ],
      };
    },
  },
];
