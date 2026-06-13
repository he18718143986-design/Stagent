# autoAI — Copilot 开发指令

## Bug 修复四步流程
每次修复 bug，必须完成全部四步：
1. **诊断根因** — 找到出错的精确代码行和作用域问题
2. **映射 SPEC** — 在 SPEC.md 中定位对应章节，说明哪条规范被违反
3. **最小化修复** — 只改必须改的代码，不引入重构或新功能
4. **写回归测试** — 每个 bug 必须有对应测试，注释标明防止哪个 bug 复现

## 测试分层
| 层级 | 框架 | 用途 |
|------|------|------|
| 单元测试 | vitest (`src/main/*.test.ts`) | 测试单函数逻辑，mock 所有 I/O |
| E2E 测试 | Playwright (`e2e/*.spec.ts`) | 跨进程集成，使用 mock HTTP server |

- mock server / fixture helpers 放 `e2e/helpers/`
- 测试文件顶部注释列出保护的 bug 及修复说明

## 回归测试格式约定
```typescript
describe('模块名() — 功能 (regression: 原 bug 描述)', () => {
  it('具体行为描述', async () => {
    // Before the fix: <出现了什么错误>
    // After the fix: <期望的正确行为>
  })
})
```

## 项目关键知识
- **主进程变量作用域**：`buildObserverScript()` 内的变量在外部 log 语句中不可用，必须在外部声明
- **SPA 水化延迟**：`#prompt-textarea` 可能存在但 `getBoundingClientRect` 返回 0；`ipc.ts` 在第一次 inject 失败后等待 2.5s 重试
- **URL 导航检测**：`navHandler` 在 URL pattern 匹配后等待 1.5s 并重新读取当前 URL，防止 SPA client-side redirect 触发误判
- **Electron 销毁顺序**：`window-all-closed` 触发时 childView 可能已被 Electron 内部销毁，`removeChildView` 需包在 try/catch 中
- **background view 尺寸**：background WebContentsView 是 0×0，`innerText` 为空，一律使用 `textContent`

## 文件结构速查
```
src/main/
  browser-view.ts    — WebContentsView 生命周期、登录检测
  ipc.ts             — IPC handlers，chat:send 含 retry 逻辑
  injector.ts        — 文本注入引擎
  response-watcher.ts — MutationObserver 注入，检测 AI 回复完成
  site-store.ts      — SiteConfig 持久化 JSON store
  detector.ts        — 启发式选择器自动检测
  presets.ts         — 内置站点预设选择器
e2e/
  fixtures/electron-app.ts  — Playwright + Electron fixture
  helpers/mock-site.ts      — mock AI HTTP server
  helpers/seed-store.ts     — 写入测试用 sites.json fixture
```
