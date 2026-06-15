# AGENTS.md

## Cursor Cloud specific instructions

autoAI is an **Electron + React + TypeScript desktop app** with two pillars: a unified AI
chat client and the `@stagent/core` workflow engine (`packages/stagent-core`). Standard
commands live in `README.md` and `package.json` `scripts` — use those; the notes below only
cover non-obvious caveats.

### Running the app (GUI)
- `npm run dev` (electron-vite) launches a real Electron window, so it **needs a display**.
  This VM has an X server on `DISPLAY=:1` (the computer-use desktop); run e.g.
  `DISPLAY=:1 npm run dev`. Without a display the renderer window cannot appear.
- The following log lines at startup are **benign in this headless VM** and do not indicate a
  failure: `Failed to connect to the bus: ... Unknown address type` and
  `Exiting GPU process due to errors during initialization`. The app still creates its window,
  registers Stagent IPC, and starts the local adapter server at `http://127.0.0.1:8787`.
- `build:core` (compiling `@stagent/core`) runs automatically via the `predev`/`prebuild`/
  `pretest`/`pretypecheck` hooks, so you normally do not need to run it by hand.

### Lint / test / build
- `npm run lint` currently reports **2 pre-existing errors** (unused vars in
  `StagentPage.tsx` and `SimpleExecutionScreen.tsx`) plus some warnings. These are existing
  code issues, not environment problems — do not "fix" them as part of unrelated work.
- `npm test` (vitest, renderer + lib unit tests) passes fully.
- `cd packages/stagent-core && npm test` (node:test engine suite) has **3 known failures** in a
  standalone checkout: the ADR calibration tests load
  `.stagent/charter/calibration/questions.jsonl` resolved 5 levels above `dist/test`. In CI the
  repo is nested under `autoAI/` so that path lands on a sibling data file; in this standalone
  checkout it resolves to `/.stagent/...` which does not exist. This is structural, not an
  environment defect.
- `npm run test:e2e` (Playwright + Electron) requires `npm run build` first and also needs a
  display (`DISPLAY=:1`); it uses a local HTTP mock server so no external network is required.
- Live Stagent feedback runs (`npm run feedback:live*`) need a real LLM key
  (`DEEPSEEK_API_KEY` / `LLM_API_KEY`, see `.env.example`); the default `npm run feedback` is a
  mock run that needs no key.
