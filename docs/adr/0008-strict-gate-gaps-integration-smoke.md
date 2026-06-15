# ADR-0008: Strict 门缺口与真实集成冒烟门

## 状态

Proposed — 2026-06-15

## 背景

T6（确定性多切片平台：CRUD + 状态机 + CSV 管道，Python）在「省钱非对称配置」（`LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_TEST_WRITE=deepseek-v4-pro`）+ forward-slice 修复（ADR-0007）下，headless 报告 **strict 1/1 通过**（49 stages，pytest 91 passed，MVP 目录 + traceability 命中）。

对产物工作区做**独立核验**（真实运行，非静态推断）后发现：**该产物并非合格软件**，strict-green 是「空心绿」。核验证据：

- `pytest` 91 passed（全绿）。
- `python main.py`（venv）exit 0，但交付的 `summary.json` = `{"todo":0,"in_progress":0,"done":0,"cancelled":0}`（全 0，无意义）。
- 用**真实 `TaskStore` + 真实 `import_tasks_from_csv`** 喂一条合法行 → `TypeError: add() got an unexpected keyword argument 'status'`（崩溃）。
- `tasks.csv` 内容是 `timestamp,open,high,low,close,volume`（**T4 期货 K 线数据**，非 todo），无 `title` 列 → 全部行判非法跳过。

### 根因（按缺口归类）

1. **协作者 mock 假绿**：`test_pipeline.py` 用 `MagicMock()` 充当 store + `patch("pipeline.validate_task")`。mock 接受任意参数，**掩盖了** `pipeline` 调 `store.add(..., status=...)` 而真 `TaskStore.add(self, title, priority=3)` 无 `status` 参的集成 bug。测试只验证「调用形状」，从不验证真实协作者能否接受。
2. **无真实集成冒烟**：strict 门校验「流水线跑完 + pytest 绿 + MVP 目录 + traceability」，但全程未用**真实依赖**跑主路径一次。
3. **fixture 污染未检**：CSV 表头（期货列）与任务声明字段（`title,priority,status`）不匹配，无人校验 → 产出全 0 且掩盖缺陷 1（合法行从未执行到 `store.add`）。
4. **错误被吞**：`main.py` 宽 `except Exception` 把致命错误吞成 exit 1/静默。
5. **为过契约塞占位导出**：`pipeline.skipped = 0`、`main.PermissionError = PermissionError` 等纯为满足导出契约门，无功能意义。

`TestQualityLint` 现有规则（无断言 / 恒真 / `@patch('<prod>.x')` / `sys.modules` 劫持等）**抓不住**「把协作者整体换成 `MagicMock` 注入、只断言 call shape」这类假绿——这是 lint 的真实盲区。

## 决策

### 1. 真实集成冒烟门（post-delivery / pre-accept，hard）

交付前必须用**真实依赖**跑一次主路径，禁止全程 mock 的「绿」：

- software 任务：执行入口（如 `python main.py` / `node dist/main.js`），断言**产物输出存在且非平凡**（如 `summary.json` 字段齐全且并非「全部为初始/零值」）。
- 提供任务级「冒烟断言」钩子（沿用 mvp/traceability 的声明式风格）：声明「运行 X → 输出 Y 满足断言 Z」。
- 冒烟失败 → 非 strict pass（与 `blockDeliveryOnTestFailure` 同级 hard）。

#### 1b. 真实集成冒烟「工作流内阶段」化 + fix 回路（A1 根治，2026-06-15 落地）

上文「post-delivery 冒烟门」诚实判红，但**无 fix 回路**——它是 strict 验收阶段的事后门，捕获到「main 空转 / 产出平凡」只能判失败，不能自动修复。根因（LLM 偶发不写 `if __name__` / 不建输出目录）需要在工作流内被**自动修复**，而非交付后才发现。

**决策**：把真实集成冒烟做成**工作流内阶段**，复用既有 test_run 自修复骨架：

- `disk-bootstrap/smokeStage.ts` 的 smoke 阶段改名 **`stage_test_run_smoke`**（test_run 语义 `smoke`），从而被 `isTestRunStageId` 识别、参与 `trySelfHealAfterTestRunFailure` → fix → `afterFixIfFailedStage` 回绕重跑的既有回路。
- oneShot 批处理入口（main.py/cli）：smoke 命令在跑完主入口后追加 **`&& node verify-smoke-output.mjs`**（`packages/stagent-core/scripts/`），断言 config.yaml 声明的 JSON 产出存在且非平凡（与本门 `isTrivialJsonValue` 同源）；缺产出 / 全零 → 脚本非零退出 → smoke 失败。
- 注入配对修复阶段 **`stage_fix_if_failed_smoke`**（`skipIf=exitCodeZero`），由 `FixExhaustedRouter.resolveTestRunStageIdFromFix` 映射回 `stage_test_run_smoke`；prompt 针对「main 真跑不起来 / 产出平凡」指引修主入口（`if __name__` 调 main、`os.makedirs(exist_ok=True)`、不宽 `except` 吞错、产出由真实逻辑写出）。
- 仅 oneShot 接产出断言 + fix 链；serve 模式（长驻服务）沿用既有 exit-0 探活语义。`isSmokeStageId` 统一识别新旧 id（serve 应用 LLM 仍可自编排 `stage_smoke_run`），保证向后兼容。

**与 post-delivery 冒烟门的关系**：二者互补、防御纵深。工作流内 smoke 在**交付前**自动修复空心绿；headless `mvp.smoke` 事后门保留为最终复核（若两者口径一致，事后门在 A1 生效后应稳定通过）。

**验证证据（确定性核验，零模型变量）**：对 T6 类工作区注入 A1 的 smoke 命令——
- main 缺 `if __name__` → `python main.py` exit 0（旧 exit-0-only 门会**假绿放行**），A1 smoke `&& node verify-smoke-output.mjs` 判红（`产出缺失/为空：output/summary.json`）；
- 产出全 0（fixture 污染/管道失效）→ A1 判红（`产出无意义（全为零/空值）`）；
- 补回 `if __name__: main()` + 真实数据 → smoke exit 0、产出 `{"todo":1,"in_progress":1,...}` 非平凡。

路由集成由单测锁定：`findFixStageForTestRun(wf,'stage_test_run_smoke') === stage_fix_if_failed_smoke`、`stageHasDownstreamFixChain` 为真、`resolveTestRunStageIdFromFix('stage_fix_if_failed_smoke') === 'stage_test_run_smoke'`。

### 2. 协作者 mock 假绿检测（TestQualityLint 扩展）

新增坏味种类：**`collaborator-mock-only`**——一个切片的测试若**把被测模块的关键协作者整体替换为 `MagicMock` / `patch` 后只断言其被调用的形状**（`assert_called_with` / `assert_any_call` / `call_count`），而无任何对**真实协作者行为**的断言，视为假绿高危。

- Python detector：`MagicMock()` 作为被测函数入参 + 仅 `assert_*call*` 断言；`patch("<prod>.<symbol>")` 指向**本切片的直接依赖模块**。
- Node detector：`vi.fn()` / `vi.mock(<prod>)` 注入 + 仅 `toHaveBeenCalledWith` 断言（接 ADR-0005 的 `nodeTestQualityAdapter`，扩展其 `internal-module-mock` 维度）。
- 首版 warn，稳定后对「切片间集成点」升 hard；与「真实集成冒烟门」互补（冒烟兜底真实行为，lint 提前预警）。

### 3. Fixture 一致性门（pre-impl / pre-test，hard）

校验任务声明的数据契约与落盘 fixture 一致：

- CSV/JSON 等数据 fixture 的表头/字段须覆盖任务声明的字段（如 `title,priority,status`）。
- 不匹配 → block，提示重建 fixture（呼应 `smokeDataBootstrap`：种子数据须按当前任务字段生成，禁止复用其它任务的种子）。

### 4. 配套整改（针对引擎/模板）

- 收紧生成代码的入口错误处理：致命错误非零退出并暴露，不被宽 `except` 吞没（写入 impl/质量 prompt 的预防指引，遵循 ADR-0007 prevention-at-impl）。
- 导出契约校验区分**真实导出 vs 占位**：禁止以「`X = X` / 无意义模块级常量」满足导出契约。

## 验收

- 对本 T6 产物：修复 `TaskStore.add` 接受 `status`（或 pipeline 不传 status、改用 add 后 update），重建匹配的 `tasks.csv`，则真实集成冒烟应输出非零 summary；协作者 mock 假绿用例被 lint 标记。
- 回归：现有 strict pass 任务在加冒烟门后仍 pass（若不 pass，说明该任务此前也是空心绿，应修）。

## 后果

- **正向**：堵住「便宜模型 + 弱门 = 看似绿、实不可交付」的系统性风险；strict-green 从「跑完且 pytest 绿」升级为「真实可运行且产出有意义」。
- **取舍**：冒烟门增加一次真实执行成本（时间/依赖安装）；对纯库类任务需定义合理的「主路径」与非平凡断言。
- **关联**：ADR-0004（交付门禁）、ADR-0005（node adapter 承载协作者 mock 检测）、ADR-0007（prevention-at-impl 写入入口错误处理与导出真实性指引）。
- **重要修正**：此前 `live-findings-2026-06-15.md` 记的「省钱非对称配置可达 strict-green」结论需附注——它过的是**存在上述缺口的 strict 门**；门补强后需复验。
