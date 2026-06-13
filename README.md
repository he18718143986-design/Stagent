# autoAI

A desktop app with two pillars:

1. **Unified AI chat** — send messages to multiple AI chat services (ChatGPT, Claude, Gemini, DeepSeek, Kimi, and any custom site) from a single interface, without switching browser tabs.
2. **Stagent** — a decision-first AFK workflow engine (`packages/stagent-core`, published internally as `@stagent/core`) that turns a task description into a machine-readable workflow (plan → stages → quality gates → strict QA) and executes it end-to-end.

Built with Electron + React + TypeScript.

## 中文文档（推荐先看）

- [初学者完整手册](docs/初学者完整手册.md)
- [零基础操作与开发指南](docs/零基础操作与开发指南.md)
- [本地Adapter接口说明](docs/本地Adapter接口说明.md)
- [Stagent 产品需求文档（工程师评审版）](docs/STAGENT-PRD-ENGINEER.md)
- [任务全生命周期说明](docs/task-lifecycle.md)

## Features

- **Multi-account**: Add multiple accounts per AI service, each with its own isolated cookie jar
- **Unified chat**: Send messages to any connected AI from one input
- **Background rendering**: AI pages run off-screen at full size so layout APIs and rAF work correctly
- **Auto-detection**: Heuristic selector detection for new sites; falls back to guided calibration
- **Quota tracking**: Detects when a free-tier quota is exhausted and notifies you

## Quick start

```bash
npm install
npm run dev        # development (hot reload)
npm run build      # production build → out/
```

## Testing

```bash
npm test           # unit tests (vitest)
npm run test:e2e   # e2e tests (playwright + electron) — requires build first
```

## Project layout

```
src/main/                 Electron main process (IPC, browser-view, injection, store)
src/main/stagent/         Stagent host glue (stagent-ipc, platform adapter, LLM provider chain)
src/preload/              Context bridge (window.autoAI API exposed to renderer)
src/renderer/             React UI (ChatPage, ResourcesPage, StagentPage, components)
packages/stagent-core/    Stagent workflow engine (@stagent/core, platform-neutral)
scripts/headless/         Headless feedback pipeline (T1–T5, see npm run feedback:*)
e2e/                      Playwright end-to-end tests
docs/SPEC.md              Feature specification and data contracts
```

## Stagent (workflow engine)

```bash
npm run build:core                # compile @stagent/core (runs automatically before dev/build/test)
cd packages/stagent-core && npm test   # engine unit tests (node --test)
npm run feedback                  # mock headless pipeline check
npm run feedback:live:t4          # live T4 strict-delivery run (requires LLM access)
```

See [docs/STAGENT-PRD-ENGINEER.md](docs/STAGENT-PRD-ENGINEER.md) for architecture, acceptance tiers, and current status.

## Adding a new AI site

1. Add an entry to `PRESETS` in `src/main/presets.ts`
2. Add the matching card to `PRESET_CATALOG` in `src/renderer/src/pages/ResourcesPage.tsx`
3. Verify selectors in the app's Selector Debugger (··· → 调试选择器)
