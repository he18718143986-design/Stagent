import {
  webUserIntentHint,
  WEB_PACKAGE_JSON_IMPL_SYSTEM_PROMPT,
  WEB_MINIMAL_PROJECT_TEMPLATE_TEXT,
} from './workflow-templates/web-minimal-template';
import {
  uniappUserIntentHint,
  UNIAPP_PACKAGE_JSON_IMPL_SYSTEM_PROMPT,
  UNIAPP_MINIMAL_PROJECT_TEMPLATE_TEXT,
} from './workflow-templates/uniapp-minimal-template';
import { isAutoTaskType } from './TaskTypeResolution';
import { DECISION_ARTIFACTS_PROMPT_SUFFIX } from './commitment/parseDecisionArtifacts';

export {
  webUserIntentHint,
  WEB_PACKAGE_JSON_IMPL_SYSTEM_PROMPT,
  uniappUserIntentHint,
  UNIAPP_PACKAGE_JSON_IMPL_SYSTEM_PROMPT,
};

const DECISION_RECORD_STRICT_SUFFIX = `

【输出硬约束（必须满足）】
你必须输出 DecisionRecord（Markdown），且只能使用以下四个二级标题（不得替换标题名）：
### 职责边界
### 关键设计决策
### ★ 边界压力测试
### AI 无法验证的假设

额外要求：
1) 不包含任何代码块（禁止 \`\`\`）。
2) 总字数 <= 800。
3) “关键设计决策”中每条都要写“为什么不选备选方案”。
4) “★ 边界压力测试”至少 2 个场景，且每个场景必须写成**行首顶层**列表项（行首直接以 “- ”、“* ” 或编号 “1.”/“1)” 开头）；禁止用表格或纯段落承载，禁止写成缩进的子条目，否则内容校验按 0 计数并阻断批准。
5) “AI 无法验证的假设”至少 1 条，同样每条写成**行首顶层**列表项（“- ”/“* ”/“1.” 均可；禁止表格、纯段落或缩进子条目）。
6) 输出只包含该 DecisionRecord，不要教学说明、前后寒暄或额外小节。
`;

const RULE20_SYSTEM_PROMPT_TEXT = `
Rule 20: Decision Stage Insertion for Software Workflows

When generating a workflow for taskType='software', the following rules are MANDATORY:

20-A) For every implementation module in Layer 3 (Logic) and Layer 4 (Integration),
      you MUST insert a decision stage BEFORE the implementation stage.
      Exception: if the module is estimated to be < 30 lines, use exposeAssumptions: true instead.

20-B) Naming convention (REQUIRED):
      Decision stage id:     stage_decide_<semanticName>
      Implementation stage id: stage_impl_<semanticName>
      Both stages MUST share the same <semanticName> fragment.
      ★ The id must strictly use the patterns stage_decide_<semanticName> and stage_impl_<semanticName>. These IDs are the only stable identifiers for verification.

20-C) Decision stage input.sources MUST NOT include the full codebase.
      Only include: architecture design output + direct dependency interface definitions.
      If meta.isGreenfield !== true, also include the moduleMap from stage_zoom_out.

20-D) Every implementation stage paired with a decision stage MUST have this source in input.sources:
      { type: "stage-output", stageId: "stage_decide_<semanticName>", outputKey: "decisionRecord", label: "已确认的决策清单" }
      The implementation stage systemPrompt MUST include:
      "严格按照已确认的决策清单实现，不得偏离。如发现清单中存在矛盾，在代码注释中标注。"

20-E) TDD order: [decide_X] → [zoom_X?] → [test_write_X] → [impl_X] → [test_run_X] → [fix_test_X?]

20-H) Executable verification for any stage whose id matches /^stage_test_run_/ 
      (including paired slices):
      - tool MUST be "code-runner", NEVER "llm-text".
      - toolConfig MUST be { "type":"code-runner", "command":"<shell>", "captureOutput": true }
      - command MUST run real tests/commands on disk (prefer npm test / npm run test / project runner).
      - Forbidden: having the LLM only narrate test outcomes without executing code-runner.
      - Prefer pathBase "workspace" + workingDir "." so npm 在「工作文件夹」子项目根执行（引擎亦会对未声明的 stage_test_run_* 默认补齐）。

20-I) Disk bootstrap (generator SHOULD align; engine 另会强制注入同语义阶段):
      - 工作流开头应有在「工作文件夹根」执行的 npm 初始化（npm init -y），pathBase "workspace"。
      - 每个 stage_impl_* 产出必须为**可落盘的真实源码/配置**（禁止仅空洞确认句）；并应配合 file-write（pathBase "workspace"）写入相对路径文件，或依赖引擎在 impl 后自动插入的 bundle 落盘阶段。

20-F) EVERY isDecisionStage=true stage's toolConfig.systemPrompt MUST end with the
      adversarial quality instructions defined in §7.5. Do NOT omit or paraphrase them.

20-G) If meta.isGreenfield !== true, insert stage_zoom_out BEFORE the first Layer 3-4 module:
      - tool: file-read, reads all Layer 1 type definition files
      - outputs: [{ key: 'moduleMap', format: 'markdown' }]
      All subsequent decide_X stages must include moduleMap in input.sources.

FORBIDDEN: Inserting decision stages for Layer 1, Layer 2, or Layer 5.
FORBIDDEN: Omitting the adversarial quality instructions from any decision stage's systemPrompt.
`;

/** 基建/测试策略借鉴 ai-workflow 类实践；命令形态与门禁仍以 Stagent（Rule20、lint、失败落盘）为准。 */
const ENGINEERING_TEST_STRATEGY_BORROWING_TEXT = `
Layered engineering & test strategy (borrow infra patterns; keep Stagent gates):

INFRA (workspace / TypeScript — reduces spurious code-runner failures):
- When generating a workspace tsconfig.json, include "strict": true and "esModuleInterop": true (default-import interop with CommonJS typings; avoids TS1259-class errors in tests).
- Any tsc in code-runner MUST use explicit project: npx tsc -p tsconfig.json ... (plus the already-listed legal stage_test_run_* command shapes; must pass Stagent CodeRunnerCommandLint + validateGeneratedWorkflow).

PURE LOGIC vs VS Code API (borrow separation of concerns):
- Unit tests executed via plain node ./out/... or npx ts-node ... MUST only import modules that do NOT have a top-level "import * as vscode from 'vscode'" (split pure scan/algorithm into a vscode-free module and test that); otherwise Node fails with Cannot find module 'vscode'.
- Optional later: VS Code integration tests may use @vscode/test-electron; do NOT require every workflow to add a full E2E harness (avoid stage bloat).

STAGENT-OWN (do NOT substitute or weaken):
- Do NOT replace the above with an ai-workflow-style "first-token binary allowlist" on entryCommand; Stagent relies on task-type + Rule 20 + CodeRunnerCommandLint + workflow validation instead.
- Rule 20 / DecisionRecord four headings / Rule20 verify / SPEC §7.8 global architecture decision rules remain mandatory as already stated.
- Failures append .wf-failures.jsonl under the task workspace; use host repo npm run analyze:failures to aggregate stageId/errorType for prompt/lint feedback loops.
`;

/** Python code-runner 命令形态（prototype / other / 含 pip 或 .py 的验证阶段必遵；避免 pip 与 python 解释器不一致）。 */
export const PYTHON_CODE_RUNNER_CONSTRAINT_TEXT = `
INFRA (workspace / Python — mandatory when code-runner runs .py, pytest, or pip installs):
- pathBase MUST be "workspace", workingDir "." (task folder root).
- ALWAYS use python3; NEVER bare \`python\` or bare \`pip\`.
- Before the first pip install in the workflow, create a project-local venv: python3 -m venv .venv
- Install deps ONLY via: .venv/bin/python -m pip install ...  (e.g. .venv/bin/python -m pip install -r requirements.txt)
- Run scripts/tests ONLY via: .venv/bin/python <script.py>  or  .venv/bin/pytest ...
- Prefer ONE chained code-runner command per verification stage, e.g.:
  python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt && .venv/bin/python mock_pipeline.py
- FORBIDDEN: \`pip install -r requirements.txt && python script.py\` (pip/python interpreter mismatch on macOS/Linux).
- FORBIDDEN: \`pip install\` without \`python3 -m venv .venv\` when requirements.txt or third-party imports exist.
- TIMEOUT (cold-start native deps): the venv+pip install stage MUST set toolConfig.timeout >= 120, AND its chained command MUST END with a warm-import of the heavy deps just installed, e.g.: \`... && .venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -c "import pandas, numpy, openpyxl"\`. This pays the one-time cold cost (first pandas/numpy import + macOS first-run verification of freshly downloaded wheel .so/.dylib) INSIDE the install budget, so later check stages stay fast.
- TIMEOUT (per check stage): any code-runner stage whose command imports heavy native packages (pandas / numpy / scipy / lxml / pillow / matplotlib …) MUST set toolConfig.timeout >= 90; especially the FIRST import-check stage right after venv setup. Without the warm-import above, the first cold heavy-import can exceed a 30s budget and fail with code-runner-timeout even though a retry then runs in a few seconds. Stages that only import stdlib / requests may keep the default.
`;

/** Python / 多文件原型：每文件一阶段 writeOutputToFile，禁止 mega setup 脚本。 */
export const PROTOTYPE_MULTI_FILE_WRITE_TEXT = `
MULTI-FILE prototype disk layout (MANDATORY when deliverable is Python project or multiple config/data files):
- NEVER generate one mega script (e.g. setup_project.py / bootstrap.py) that embeds entire project files as triple-quoted string literals.
- Each on-disk artifact MUST be its own llm-text stage with writeOutputToFile + writePathBase "workspace":
  - stage_impl_prototype_requirements → requirements.txt
  - stage_impl_prototype_config_yaml → config.yaml (or config.json)
  - stage_impl_prototype_config_py → config.py
  - stage_impl_prototype_reader → reader.py
  - stage_impl_prototype_fetcher → fetcher.py
  - stage_impl_prototype_analyzer → analyzer.py
  - stage_impl_prototype_writer → writer.py
  - stage_impl_prototype_main → main.py
  - optional stage_impl_prototype_mock_data → mock_data.json
  - optional stage_impl_prototype_create_sample → create_sample.py (ONLY if small, <200 lines)
- Each stage systemPrompt MUST request ONLY that single file's complete content (no nested file generators, no markdown wrapping other paths).
- Order: decision → requirements/config → core modules → main → optional sample data → stage_test_run_prototype_experiment (venv + pip + run).
- Keep each impl stage output focused (<800 lines per file); split modules instead of one 20k-char blob.
FORBIDDEN:
- setup_project.py / generate_all.py / write_all_files() patterns.
- One stage whose writeOutputToFile is a script that writes 5+ other source files via embedded strings.
`;

/** M20：落盘 artifact 与 test_run import / 下游输入对齐（闭合磁盘↔LLM↔验证三角） */
export const ARTIFACT_INPUT_ALIGNMENT_TEXT = `
ARTIFACT / input alignment (MANDATORY for prototype & multi-file Python):
1) Maintain ARTIFACT_REGISTRY mentally: every writeOutputToFile / file-write path (requirements.txt, config.yaml, reader.py, …) is the ONLY legal import/script target for later stage_test_run_* commands.
2) If ONLY config.yaml is generated (no config.py), FORBIDDEN: python -c "from config import load_config". Use yaml.safe_load(open('config.yaml')) OR add stage_impl_* writeOutputToFile: config.py.
3) Each stage_test_run_* python -c MUST only import top-level modules matching an existing *.py artifact (reader→reader.py). Stdlib (sys/json/os) OK; third-party OK if listed in requirements.txt.
4) After each core impl (reader/fetcher/analyzer/writer/main), SHOULD insert stage_read_<semantic> (tool file-read, filePath = same as writeOutputToFile, outputs fileContent) OR next impl input.sources MUST include stage-output from prior impl (contextMode full when large).
5) Integration stage_test_run_* MUST run main.py/monitor.py entry with mock config — not a one-off python -c that imports modules absent from ARTIFACT_REGISTRY.
6) Config key names (mock_mode / MOCK_MODE / endpoint_url) MUST match across config.yaml, fetcher.py, main.py; record canonical keys in decisionRecord.
7) type=file input sources for on-disk artifacts SHOULD use pathBase "workspace" + filePath relative to task workspace (aligns with ai-workflow existingFile under taskDir).
8) HARD: every script you later run with code-runner ("python X.py", e.g. create_sample.py / main.py / monitor.py) MUST FIRST be produced by its OWN dedicated llm-text stage whose toolConfig.writeOutputToFile == X.py (NOT a stage-top-level field, NOT bundled inside another file's stage, NOT emitted by a mega setup_project.py). If a stage_test_run_* runs "python main.py" but no prior stage has writeOutputToFile: main.py, generation is rejected with python-script-not-in-artifacts.
9) MODULE NAMING: ARTIFACT_REGISTRY filenames are the SINGLE source of truth for module names. Any stage that imports sibling project modules — especially the integration entry (main.py / monitor.py) and any impl importing another impl — MUST import using EXACTLY those filename basenames (analyzer.py → "from analyzer import ..."). FORBIDDEN to invent or rename a module (e.g. "from comparator import compute_diffs" when the comparison logic lives in analyzer.py). The decisionRecord MUST refer to each module by the SAME basename as its writeOutputToFile — no synonyms (comparator vs analyzer, util vs utils, helpers vs helper). The producing stage AND every consuming stage systemPrompt MUST cite the identical module name; the main/integration stage systemPrompt MUST embed the explicit import list (from reader import ...; from fetcher import ...; from analyzer import ...; from writer import ...).
10) CROSS-MODULE FUNCTION CONTRACT: for every public function called across modules, the decisionRecord MUST pin a MODULE_CONTRACT line — module.func(params) -> container & EXACT field names (e.g. fetcher.fetch_online_data(asins, cfg) -> list[dict{asin, price, stock, in_stock, delivery_days, query_status}]). Each producer AND consumer impl stage systemPrompt MUST restate that exact signature AND return shape (container type + field names). FORBIDDEN: producer returns a list while the consumer indexes it by key (online_data.get(asin) on a list); FORBIDDEN: field-name drift (producer online_price/available_stock/shipping_cost vs consumer price/stock/freight). Do NOT paper over a shape mismatch with an ad-hoc adapter in main.py — align the container type and field names at BOTH the producer and the consumer instead.
11) DELIVERABLE CLOSURE (HARD): if the task states a concrete output artifact (CSV / 报告 / 导出文件 / 报表), the plan MUST NOT end at an intermediate module (e.g. analyzer). It MUST include, in order: (a) the writer/output stage that actually produces the deliverable (e.g. writer.py writing the CSV); (b) a main/pipeline ENTRY stage (main.py) that wires the whole flow read→fetch→analyze→write; (c) a FINAL end-to-end integration stage_test_run_* that runs ".venv/bin/python main.py" with mock config and then ASSERTS the deliverable: file exists + key invariants (row count and/or required column headers), e.g. python -c "import csv,os;assert os.path.exists('output.csv');rows=list(csv.DictReader(open('output.csv',encoding='utf-8-sig')));assert len(rows)>=1". A plan that writes modules but never produces & asserts the stated deliverable is INCOMPLETE and is rejected.
12) VERIFICATION COVERAGE (HARD): every core impl module (reader/fetcher/analyzer/writer/main …) MUST be covered by at least one code-runner check — do NOT leave the LAST core module (typically analyzer/writer/main) unverified just because it is last. Beyond isolated per-module smoke checks, at least ONE check MUST be an INTEGRATION check that feeds a REAL upstream module's output into the downstream module (e.g. data=read_excel(...); items=fetch_online(...); analyze(items)) so cross-module contracts (rules 9-10: module names, field names, container types) are actually exercised. Isolated single-module checks alone are insufficient and do not satisfy this rule.
13) DATA_SCHEMA CONTRACT (HARD, M21): the decisionRecord MUST contain an explicit DATA_SCHEMA block pinning, for EACH record/dict that crosses a module boundary, the EXACT field names + types + allowed enum values. Examples that MUST be pinned verbatim and reused everywhere (producer + consumer + mock data + sample data):
    - excel row keys (e.g. asin, tk_sku, target_price, stock) — the SAME keys reader.py outputs, analyzer.py reads, and writer.py emits;
    - online/fetch record keys (e.g. asin, price, stock_status, shipping_cost, delivery_date, query_status) — identical in fetcher.py output, mock_data.json keys, and analyzer.py consumption;
    - the EXACT enum value used to mean "query succeeded" (pick ONE literal, e.g. query_status == "success") — fetcher.py MUST emit that literal and analyzer.py MUST compare against the SAME literal (FORBIDDEN: producer emits "success" while consumer checks != "OK"; FORBIDDEN: case/spelling drift availability vs stock_status, delivery_date vs estimated_delivery_date, sku vs tk_sku, stock vs expected_stock).
    Every impl stage systemPrompt MUST restate the exact key names + success enum it produces/consumes, citing the decisionRecord DATA_SCHEMA. mock_data.json keys MUST equal the fetcher output keys; do NOT invent parallel names.
14) SHARED SAMPLE SOURCE (HARD, M21): sample data (create_sample.py → input.xlsx) and mock data (mock_data.json) MUST share ONE canonical key list (e.g. the ASIN/SKU identifiers). They MUST NOT each invent unrelated identifiers (FORBIDDEN: create_sample uses B0ABCDEF01..05 while mock_data uses ASIN001..005 → every lookup misses → 100% "not found"). Enforce sharing structurally: the decisionRecord MUST list the canonical sample identifiers, AND the mock_data stage's input.sources MUST include the create_sample stage output (type:"stage-output", stageId:"stage_impl_prototype_create_sample") — OR vice versa — so the model generating one literally sees the other's identifier list. Both stage systemPrompts MUST restate the identical identifier list.
15) INTEGRATION CORRECTNESS ASSERTION (HARD, M21): the final integration stage_test_run_* that runs main.py with mock mode MUST assert RESULT CORRECTNESS, not merely row count. At minimum it MUST assert: (a) the deliverable exists; (b) at least ONE row has query_status == "success" (the canonical success literal from rule 13) — proving ASIN matching + field mapping actually worked; (c) at least ONE row carries a meaningful analysis outcome (a non-empty alert label OR an explicit "正常/normal" verdict). FORBIDDEN: an integration assertion that passes when every row is "获取失败 / not found" (i.e. only "assert len(rows) >= N"). Example: python -c "import csv;rows=list(csv.DictReader(open('output/diff_report.csv',encoding='utf-8-sig')));ok=[r for r in rows if r.get('query_status')=='success' or r.get('接口售价')];assert ok, 'no successfully-matched row — check ASIN source & field-name contract'".
16) ONE-SLICE-ONE-LOOP / RED-BEFORE-GREEN (SOFT, M22, I-25): prefer interleaving per slice — for a slice <X>, order it as stage_test_write_<X> -> stage_impl_<X> -> stage_test_run_<X>, so each slice gets its own red→green cycle. FORBIDDEN (horizontal TDD): batching ALL stage_test_write_*/stage_test_run_* before ALL stage_impl_* — this delays the feedback loop. A paired test MUST be capable of failing before the implementation exists (assert real behavior, never a tautology like "assert True" or "assert module is not None").
`;

/** Excel/CSV 原型：样本文件路径与列名在全工作流内必须一致（避免 create_sample 与 integration 分叉）。 */
export const PROTOTYPE_EXCEL_FIXTURE_ALIGNMENT_TEXT = `
EXCEL / sample-data alignment (MANDATORY when workflow uses create_sample.py + Excel + stage_test_run_*):
1) Pick ONE canonical relative path for the sample/working Excel file (default: input.xlsx). Record it in the decision record and reuse everywhere — do NOT mix sample_input.xlsx / input.xlsx / data/input.xlsx across stages.
2) stage_impl_prototype_create_sample (create_sample.py) MUST write exactly that path (e.g. wb.save("input.xlsx")).
3) config template (config.yaml / config.yaml.template) input.file MUST be the same path; monitor.py / main entry MUST read via config (no hard-coded alternate filename).
4) Canonical Excel header columns (English identifiers, one set for whole project): ASIN, SKU, TargetPrice, Stock — unless decision record explicitly defines aliases; then create_sample, config columns.*, reader.py, monitor.py, and EVERY stage_test_run_* command MUST use the same names/mapping.
5) FORBIDDEN: create_sample with Chinese headers (目标价/库存) while monitor.py validates TargetPrice/Stock; FORBIDDEN: reader_check code-runner hard-codes sample_input.xlsx while integration runs monitor against input.xlsx.
6) stage_test_run_prototype_create_sample_run must run create_sample.py; subsequent stage_test_run_* that read Excel MUST reference the same file path as step 1 (e.g. load_excel('input.xlsx', ...) or monitor with config pointing to input.xlsx).
7) Integration stage_test_run_* MUST run the real entry script (monitor.py/main.py) with mode:mock (or cp config template with mode: mock + matching input.file) — not a one-off python -c that uses different paths/columns than the integration command.
8) In workflow JSON, add a short stage description or constant comment listing FIXTURE_EXCEL=input.xlsx and FIXTURE_COLUMNS=ASIN,SKU,TargetPrice,Stock so all impl/test stages stay aligned.
`;

const VERTICAL_SLICE_CONSTRAINT_TEXT = `
Vertical Slice Constraint (to-issues):
Decompose the workflow into thin vertical slices. Each stage group must cut through all architectural layers (skeleton → plumbing → logic → integration) and be independently verifiable/demoable.
FORBIDDEN: Horizontal layering that groups all interface definitions first, then all implementations. Every slice must contain its own decision-implement-test cycle.
Prefer AFK (agent-executable without human) stages; mark human interaction explicitly where needed.
MANDATORY: For each stage_impl_<X>, generate its paired verification chain with explicit ids:
  - stage_test_write_<X>
  - stage_test_run_<X> MUST use tool "code-runner" per Rule 20-H (never llm-text for stages whose id starts with stage_test_run_)
unless the module is exempted by Rule 20-A (<30 lines with exposeAssumptions=true). Exemptions must be explicitly annotated.
MANDATORY: Every slice must be independently verifiable. A slice without runnable verification (actual code-runner execution) is invalid.
MANDATORY: Avoid monolithic impl naming like stage_impl_all / stage_impl_core / stage_impl_everything.
`;

/** 用户 meta.userInput 是否显式倾向「完整项目 / 多模块 / 全栈」（与 SPEC §7.8.2 条件 2 对齐，供生成提示与测试）。 */
export function multiModuleUserIntentHint(userInput: string | undefined): boolean {
  if (!userInput?.trim()) {
    return false;
  }
  return /完整项目|多模块|全栈|全栈项目|端到端|管理系统.*小程序|小程序.*管理后台|multiple\s+modules|full[\s-]?stack|full\s+project/i.test(
    userInput,
  );
}

const SPEC_78_MULTI_MODULE_TEXT = `
SPEC §7.8 Multi-Module / Full-Project (taskType='software', generator MUST obey when triggers hit):

WHEN either applies:
  (A) You plan MORE THAN FIVE distinct Layer 3–4 modules/slices (count distinct stage_impl_* planned),
  (B) The user's task text (meta.userInput in payload) hints multi-module / full-stack / end-to-end product;
THEN BEFORE the first per-slice stage_decide_<semantic>:
  - Insert ONE global decision stage: isDecisionStage=true, tool=llm-text,
    RECOMMENDED id: stage_decide_architecture_overview (or a clearly GLOBAL semantic id matching stage_decide_architecture_* / stage_decide_global_*).
  - Its DecisionRecord (§4.4 four headings, NO code blocks) MUST include in prose/table form:
    1) Module boundary table: slice/module → responsibility → upstream deps (layers/modules).
    2) Inter-module interface CONTRACT (public surfaces only — NO internal impl trivia): errors, compatibility, idempotency as relevant.
    3) Stage budget under HARD CAP 50 stages (§13.1): estimate counts for global/cross-cutting decides, each slice decide→test_write→impl→test_run(+fix?), skeleton compile + verification tail.
       If estimate exceeds 50, you MUST conceptually attach workflowGenerated.warnings semantic stage_count_exceeds_50 AND propose actionable reductions in the DecisionRecord text.

Guideline ratios when §7.8 triggers (non-script-enforced): global+cross-cutting ≤ ~15 stage equivalents; slice chains ≤ ~30; compile/smoke/doc tail ≤ ~5.

Dependencies today:
  - Express ONLY via input.sources stage-output ordering (referenced stage before consumer); stages[] MUST stay topologically valid for those refs.
  - Optional JSON field dependsOn?: string[] lists prerequisite stage ids — each MUST appear earlier in stages[] (validated); ENGINE STILL RUNS LINEAR currentStageIndex++ only (NOT DAG scheduler).

Rule 20-A still applies PER slice after global blueprint is approved — global stage does NOT replace per stage_decide_<semantic> pairs for Layer 3–4 impl modules (unless Rule 20-A exemption per slice).
`;

const LAYER_1_TO_5_TEXT = `
Layer 1 骨架层（Skeleton）
  内容：类型定义、配置文件、接口声明
  特征：无逻辑实现，纯声明

Layer 2 管道层（Plumbing）
  内容：工具函数、适配器、格式转换
  特征：无业务逻辑，只依赖 Layer 1

Layer 3 逻辑层（Logic）
  内容：核心业务模块、状态机、服务
  特征：核心逻辑所在，依赖 Layer 1-2
  ★ 每个模块必须有决策阶段前置（isDecisionStage）

Layer 4 集成层（Integration）
  内容：入口文件、路由、组装层
  特征：组装 Layer 1-3，不含新业务逻辑
  ★ 每个模块必须有决策阶段前置（isDecisionStage）

Layer 5 强化层（Hardening）
  内容：端到端测试、错误处理、文档
  特征：所有其他层都已存在后再写
`;

const REFACTOR_CONSTRAINT_TEXT = `
Refactor Workflow Constraint (taskType='refactor'):
目标：在不改变外部可观察行为的前提下，优化模块边界、依赖方向和可测试性。
MANDATORY:
1) 必须包含至少 1 个架构决策阶段：stage_decide_refactor_<X>（isDecisionStage=true, pauseAfter=true, outputs 包含 decisionRecord）。
2) 每个实现阶段必须成对出现验证链：stage_test_write_<X> -> stage_impl_<X> -> stage_test_run_<X>（或等价 code-runner 验证）。
3) stage_impl_<X> 的 input.sources 必须包含 decisionRecord 依赖，并在 systemPrompt 中包含：
   "严格按照已确认的决策清单实现，不得偏离。如发现清单中存在矛盾，在代码注释中标注。"
4) 优先 AFK；若出现多个 HITL 暂停点，必须在描述中说明必要性。
FORBIDDEN:
- 只输出“重命名/格式化”而无验证阶段的工作流。
- monolithic 命名（例如 stage_impl_all / stage_impl_everything）。

工程与测试（分层借鉴，与 software 同源）：子项目 tsconfig 建议 strict + esModuleInterop；可被 node/ts-node 直接跑的测试只 import 无顶层 vscode 的纯模块；tsc 一律 npx tsc -p tsconfig.json。仍须遵守 Stagent 的 Rule 20、决策记录与 CodeRunnerCommandLint，不用命令二进制白名单替代。
`;

const DEBUG_CONSTRAINT_TEXT = `
Debug Workflow Constraint (taskType='debug'):
目标：围绕“可复现 -> 可解释 -> 可验证修复”构建最小调试闭环。
MANDATORY:
1) 建议包含阶段：stage_decide_debug_scope -> stage_reproduce_debug_case -> stage_hypothesis_debug_root_cause -> stage_impl_debug_fix -> stage_test_run_debug_regression。
2) 必须至少有一个可执行复现或验证动作（优先 code-runner）。
3) stage_impl_debug_fix 的输入应包含 decisionRecord 或 hypothesis 类输出（避免盲修）。
4) 输出应体现：复现条件、根因假设、修复后验证结果。
5) 反馈回路优先（I-26）：可执行复现/回归（code-runner / reproduce）阶段必须排在「根因假设」与「修复实现」之前——先建立能稳定复现的失败信号，再假设、再修。
FORBIDDEN:
- 只有“修复实现”而无复现/验证阶段。
- 无法说明成功判据（例如“看起来修好了”）。
- 把假设/修复阶段排在任何可执行复现之前（违反反馈回路优先）。

工程与测试（分层借鉴）：tsconfig 建议 esModuleInterop；纯逻辑与 vscode 分离以便 node 侧验证；tsc 显式 -p。质量门禁仍以 debug 决策/复现链与 Stagent CodeRunnerCommandLint 为准。
`;

const PROTOTYPE_CONSTRAINT_TEXT = `
Prototype Workflow Constraint (taskType='prototype'):
目标：围绕“关键假设 -> 最小可演示实现 -> 实验验证”快速收敛可行性。
MANDATORY:
1) 建议链路：stage_decide_prototype_hypothesis -> 多个 stage_impl_prototype_<artifact>（见 MULTI-FILE 落盘）-> stage_test_run_prototype_experiment。
2) 必须在工作流中显式写出成功/失败判据（可放在决策输出或实验阶段描述；已有 code-runner 验证时可写在阶段 description）。
3) 至少包含一个可执行验证动作（code-runner 或等价 test_run 阶段）。
4) 原型实现应聚焦最小可验证路径，避免一次性全量实现。
5) THROWAWAY 纪律（M26）：若本原型仅为验证可行性（探索性 spike），其阶段描述应显式声明「探索性/一次性」，并把关键结论沉淀到 NOTES.md（决策/风险/下一步），而非把脆弱原型代码当作生产实现继续堆叠；后续若转正式实现，应另起 software/refactor 工作流而非在原型上长出生产代码。
FORBIDDEN:
- 只有实现阶段没有实验验证。
- 缺少可判定的验收结果定义。
- 把一次性 spike 代码直接当作最终交付而不做转正式实现的决策。
- 单个 setup_project.py / bootstrap 脚本内嵌全项目源码（见 MULTI-FILE）。

${PROTOTYPE_MULTI_FILE_WRITE_TEXT}

${ARTIFACT_INPUT_ALIGNMENT_TEXT}

${PROTOTYPE_EXCEL_FIXTURE_ALIGNMENT_TEXT}

${PYTHON_CODE_RUNNER_CONSTRAINT_TEXT}

工程与测试（分层借鉴）：子项目 tsconfig 建议 strict + esModuleInterop；可执行验证若含 tsc 须 npx tsc -p；node 侧测试避免顶层 import vscode。仍以 Rule 20 / 决策记录与 lint 为门禁。
`;

const SPEC_75_ORIGINAL_TEXT = `
===== 决策质量自检（在输出决策清单之前必须完成以下三项检查）=====

【检查 1 - 边界压力测试】
列出 2 个具体场景来压力测试你的设计方案。每个场景格式如下：
"当 <具体边界条件或极端情况> 时，本设计的行为是：<预期结果>。
 若此行为不可接受，则需要修改决策：<需要调整的部分>"
这两个场景必须写入决策清单的"边界压力测试"节。

【检查 2 - 隐含假设审计】
对于每个关键设计决策，识别它依赖的隐含假设（那些你认为理所当然但用户可能不同意的前提）。
每个假设格式如下：
"假设 <X> 成立。若 <X> 不成立，则需要改变：<受影响的设计决策>"
这些假设必须写入"AI 无法验证的假设"节。

【检查 3 - 代码库冲突检测】
仅当 input.sources 包含已有代码文件时执行：
检查本决策是否与已有接口声明、类型定义、或现有模块的公开 API 存在矛盾。
- 若发现矛盾：在决策清单最顶部插入 "⚠️ 潜在冲突：<冲突描述>"
- 若无矛盾：在"AI 无法验证的假设"节末尾附加 "已检查：与现有接口 <接口名列表> 无明显冲突"
若 input.sources 不包含已有代码：跳过此检查。

完成三项检查后，输出符合 §4.4 格式的完整决策清单。
===== 决策质量自检结束 =====
`;

export function safeSnippet(text: string, max = 500): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

export function looksLikeRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes("sorry, i can't assist with that") ||
    t.includes('i cannot assist with that') ||
    t.includes('i can’t assist with that') ||
    t.includes('无法协助') ||
    t.includes('无法帮助')
  );
}

export function ensureDecisionPromptStrict(base: string): string {
  const cleaned = base
    .split(DECISION_RECORD_STRICT_SUFFIX)
    .join('')
    .split(DECISION_ARTIFACTS_PROMPT_SUFFIX)
    .join('')
    .split(SPEC_75_ORIGINAL_TEXT)
    .join('')
    .trim();

  const withDecisionLead =
    cleaned.includes('### 职责边界') || cleaned.includes('DecisionRecord')
      ? cleaned
      : `${cleaned}\n\n请先完成“决策清单（DecisionRecord）”，再进入实现。`;

  // Rule 20-F：每个决策阶段都必须追加 SPEC §7.5 原文（强制、不得省略）。
  return `${withDecisionLead}\n${DECISION_RECORD_STRICT_SUFFIX}\n${DECISION_ARTIFACTS_PROMPT_SUFFIX}\n${SPEC_75_ORIGINAL_TEXT}`;
}

export interface WorkflowGeneratorContext {
  /** 与即将写入 meta.userInput 的文本一致，用于 §7.8 关键词提示 */
  userInput?: string;
  /** M16.1：经 token 预算裁剪后的代码库快照文本 */
  codebaseContext?: string;
  /** M17.6：经验库 few-shot（灰度；不得注入决策阶段合同块） */
  experienceFewShot?: string;
  /** M34：已有 ADR 索引块 */
  adrContext?: string;
  /** M18.1：PromptVersionManager 槽位覆盖（缺省回退 WorkflowPrompts 硬编码） */
  promptSlots?: Partial<Record<ManagedPromptSlotName, string>>;
}

export type ManagedPromptSlotName =
  | 'RULE20_SYSTEM_PROMPT'
  | 'DECISION_RECORD_STRICT_SUFFIX'
  | 'SPEC_75_ORIGINAL_TEXT'
  | 'VERTICAL_SLICE_CONSTRAINT';

function resolvePromptSlot(
  ctx: WorkflowGeneratorContext | undefined,
  slot: ManagedPromptSlotName,
  fallback: string,
): string {
  const override = ctx?.promptSlots?.[slot]?.trim();
  return override && override.length > 0 ? override : fallback;
}

/** M16.4 PromptVersionManager 初始 seed；DECISION / §7.5 块标记 protected。 */
export function getManagedPromptSeeds(): Record<string, { content: string; protected: boolean }> {
  return {
    RULE20_SYSTEM_PROMPT: { content: RULE20_SYSTEM_PROMPT_TEXT, protected: false },
    DECISION_RECORD_STRICT_SUFFIX: { content: DECISION_RECORD_STRICT_SUFFIX, protected: true },
    SPEC_75_ORIGINAL_TEXT: { content: SPEC_75_ORIGINAL_TEXT, protected: true },
    VERTICAL_SLICE_CONSTRAINT: { content: VERTICAL_SLICE_CONSTRAINT_TEXT, protected: false },
  };
}

function appendCodebaseContextBlock(base: string, ctx?: WorkflowGeneratorContext): string {
  const parts: string[] = [base];
  const block = ctx?.codebaseContext?.trim();
  if (block) {
    parts.push(`\n\n【工作区代码库快照（仅供参考，勿当作用户任务原文）】\n${block}`);
  }
  const exp = ctx?.experienceFewShot?.trim();
  if (exp) {
    parts.push(`\n\n${exp}`);
  }
  return parts.join('');
}

const GENERATOR_JSON_SCHEMA_BASE = `你是 Stagent 工作流生成器。只输出一个合法 JSON 对象（不要 Markdown 说明），类型如下：
{
  "id": string,
  "version": "2.0",
  "meta": { "title": string, "taskType": string, "userInput": string, "createdAt": ISO8601 string, "isGreenfield"?: boolean },
  "stages": Stage[],
  "globalConfig?": { "language?": string, "enableDagScheduler"?: boolean }
}
Stage 必须包含：id, title, description?, tool, toolConfig, input, outputs, pauseAfter；
可选 isDecisionStage, aiTip, questionAfter, skipIf, patchMode, onError, dependsOn（string[]：前置 stage id，须排在 stages[] 较前位置；当 globalConfig.enableDagScheduler 为 true 时引擎按 DAG 单线程调度，否则仍按 stages[] 顺序线性执行）。
aiTip（可选 string，≤120 字）：确认页展示的本阶段审核提示——决策阶段写模块边界/接口合约；stage_test_run_* 写 venv/落盘路径/import 对齐；impl 写落盘文件名与上游 decisionRecord 关系；code-runner 失败时的常见原因一句即可。
tool 取值：常用 llm-text；凡阶段 id 匹配 /^stage_test_run_/ 时必须为 code-runner（见 Rule 20-H）。
llm-text 的 toolConfig: { "type":"llm-text", "systemPrompt": string, "writeOutputToFile"?: string, "writePathBase"?: "instance"|"workspace" }
code-runner 的 toolConfig: { "type":"code-runner", "command": string, "captureOutput": boolean, "workingDir"?: string, "pathBase"?: "instance"|"workspace", "timeout"?: number }
file-write 的 toolConfig: { "type":"file-write", "filePath": string, "sourceOutputKey": string, "sourceStageId"?: string, "pathBase"?: "instance"|"workspace" }
input: { "sources": InputSource[], "mergeStrategy": "concat"|"template"|"object", "mergeTemplate"?": string }
InputSource: user-input | constant | stage-output（引用前置阶段的输出）。
决策阶段 isDecisionStage=true 时必须 tool=llm-text，outputs 含 key 为 decisionRecord 且 format 为 markdown。
决策阶段 systemPrompt 不要自定义决策记录的小节标题（禁止写「## 决策背景 / ## 决策选择 / ## 验收条件 / ## 风险」等任何自创标题方案）：引擎会强制追加规范四标题（### 职责边界 / ### 关键设计决策 / ### ★ 边界压力测试 / ### AI 无法验证的假设）。systemPrompt 只描述任务背景、约束与接口契约，把小节结构留给该规范块，避免标题冲突触发 I-17 误判。
小型演示可仅 2～4 阶段；若触发 SPEC §7.8（多模块 / >5 个 planned impl 模块 / 用户明示完整项目意图），须扩展阶段并遵守单工作流最多约 50 阶段（超出须在生成侧 warnings 与决策文中说明）。`;

const TASK_TYPE_CLASSIFICATION_TEXT = `
【meta.taskType 分类 — 与用户任务一并判断，写入 JSON meta】
1. 阅读「用户任务」，在 meta.taskType 中写入且仅写入以下之一：
   software | refactor | debug | prototype | document | other
2. 分类指引（择一，不得臆造新枚举）：
   - software：完整可交付软件/VS Code 扩展/全栈 npm 子项目，需决策+实现+可执行测试链
   - refactor：在现有代码库上重构，外部行为等价
   - debug：复现 → 根因 → 修复 → 回归验证
   - prototype：MVP、脚本、Python/Excel/CLI、小工具、实验性验证（非完整 npm 产品）
   - document：以文档/说明产出为主
   - other：以上皆不完全贴合的轻量自动化
3. 生成 stages 时 **仅遵守** 与 meta.taskType 匹配的「类型约束块」；其余块忽略。
4. 若用户任务是 Python/Shell/数据分析脚本、读 Excel/CSV、HTTP mock，**不得**选 software，应选 prototype 或 other。
5. meta.userInput 须保留用户任务要点。`;

function buildSoftwareGeneratorAppendix(ctx?: WorkflowGeneratorContext): string {
  const emphasis =
    ctx?.userInput && multiModuleUserIntentHint(ctx.userInput)
      ? `

【.payload 提示】当前「用户任务」文本命中 §7.8 多模块/完整项目关键词：你必须插入全局架构决策阶段（推荐 stage_decide_architecture_overview），并放在首个切片 stage_decide_<语义> 之前；DecisionRecord 须含模块边界表、模块间接口合约、50 阶段预算与超限削减建议。`
      : '';

  const userIn = ctx?.userInput?.trim();
  const uniappHint = !!(userIn && uniappUserIntentHint(userIn));
  const webMinimalHint = !!(userIn && webUserIntentHint(userIn) && !uniappHint);

  const rule20Text = resolvePromptSlot(ctx, 'RULE20_SYSTEM_PROMPT', RULE20_SYSTEM_PROMPT_TEXT);
  const verticalSliceText = resolvePromptSlot(ctx, 'VERTICAL_SLICE_CONSTRAINT', VERTICAL_SLICE_CONSTRAINT_TEXT);

  return `${rule20Text}

${verticalSliceText}

${uniappHint ? UNIAPP_MINIMAL_PROJECT_TEMPLATE_TEXT : ''}
${webMinimalHint ? WEB_MINIMAL_PROJECT_TEMPLATE_TEXT : ''}

${SPEC_78_MULTI_MODULE_TEXT}

${LAYER_1_TO_5_TEXT}

${ENGINEERING_TEST_STRATEGY_BORROWING_TEXT}

补充要求（software）：
- 决策阶段 systemPrompt 采用三层构成：§7.5 原文 + grill-with-docs 补充层 + §4.4 输出约束；
- grill-with-docs 至少强制注入 Challenge terminology；
- 仅在架构级不可逆决策时启用 ADR 条件；
- 若 meta.isGreenfield !== true，先插入 stage_zoom_out(file-read) 产出 moduleMap，再由 decide_X/impl_X 消费。
- **落盘与可执行性（Rule 20-I）**：用户应将「工作文件夹」指向已或即将作为 npm 子项目的目录；每个 stage_impl_* 必须输出完整可保存的实现；stage_test_run_* 的 code-runner 应在该子项目根执行 npm test / npm run test。${emphasis}`;
}

function buildUnifiedAutoTaskTypePrompt(ctx?: WorkflowGeneratorContext): string {
  return appendCodebaseContextBlock(
    `${GENERATOR_JSON_SCHEMA_BASE}

${TASK_TYPE_CLASSIFICATION_TEXT}

===== 类型约束：software（仅当 meta.taskType=software） =====
${buildSoftwareGeneratorAppendix(ctx)}

===== 类型约束：refactor（仅当 meta.taskType=refactor） =====
${REFACTOR_CONSTRAINT_TEXT}

补充要求（refactor）：
- 架构决策阶段同样遵循三层构成：§7.5 原文 + grill-with-docs 补充层 + §4.4 输出约束；
- 必须显式给出“行为等价”验证路径（test_run 或 code-runner）；
- 若 meta.isGreenfield !== true，优先插入 stage_zoom_out(file-read) 产出 moduleMap，再由 decide/impl 消费。

===== 类型约束：debug（仅当 meta.taskType=debug） =====
${DEBUG_CONSTRAINT_TEXT}

补充要求（debug）：
- 优先 AFK 链路，尽量使用可执行阶段表达复现与回归验证；
- 若必须 HITL，需在阶段描述中写明无法自动化的原因；
- 若复现/验证涉及 Python 脚本或 pip 依赖，code-runner 须遵守 PYTHON INFRA（见 prototype 约束块中的 venv + python3 -m pip 规则）。

===== 类型约束：prototype（仅当 meta.taskType=prototype） =====
${PROTOTYPE_CONSTRAINT_TEXT}

补充要求（prototype）：
- 优先最小可运行演示（MVP）而非完整功能面；
- 每个关键假设都应对应一个可观测验证信号；
- Python 多文件项目：**每个文件单独 writeOutputToFile 阶段**，禁止 setup_project.py 一次性生成全仓库；
- Excel 样本：create_sample 与所有 stage_test_run_* 必须使用同一 input.xlsx 路径与 ASIN/SKU/TargetPrice/Stock 列名；
- Python 验证阶段 MUST 使用 python3 -m venv .venv + .venv/bin/python -m pip（禁止 pip install && python 裸命令）。
- 交付闭环（硬性，见 ARTIFACT 对齐规则 11）：任务声明了输出文件（CSV/报告/导出）时，必须包含 writer 产出阶段 + main 入口阶段 + 末尾端到端集成阶段（跑 main 并断言产物存在/行数/必需列名）；不得止步于 analyzer 等中间模块。
- 验证覆盖（硬性，见规则 12）：最后一个核心模块也必须有 code-runner check；且至少一个 check 为跨模块集成（用上游真实输出喂下游），以暴露字段名/容器类型/模块名契约错位。
- 数据契约（硬性，见规则 13）：决策记录必须含 DATA_SCHEMA，钉死每个跨模块 dict 的字段名+类型+枚举（含「成功」枚举字面量，如 query_status=="success"）；reader/fetcher/analyzer/writer/mock_data 全部复用同一组键名，禁止 availability/stock_status、sku/tk_sku、success/OK 漂移。
- 共享样例源（硬性，见规则 14）：create_sample 与 mock_data 必须共享同一 ASIN/SKU 列表；mock_data 阶段 input.sources 须引用 create_sample 阶段输出（或反之），禁止各编各的标识符导致全部「未找到」。
- 集成正确性断言（硬性，见规则 15）：末尾集成阶段必须断言「≥1 行 query_status=success + ≥1 行有效告警/正常」，而非仅 len(rows)>=N；当全部行为「获取失败」时断言必须失败。

===== 类型约束：document / other =====
- 通常 2～6 个阶段；不必 Rule 20；不必 npm init；
- 可用 llm-text + code-runner/file-write；Python 项目 code-runner 须遵守下方 PYTHON INFRA（venv + python3 -m pip）。
${PYTHON_CODE_RUNNER_CONSTRAINT_TEXT}`,
    ctx,
  );
}

function buildWorkflowGeneratorPromptForType(taskType: string, ctx?: WorkflowGeneratorContext): string {
  const base = GENERATOR_JSON_SCHEMA_BASE;

  if (taskType === 'prototype') {
    return appendCodebaseContextBlock(`${base}

${PROTOTYPE_CONSTRAINT_TEXT}

补充要求：
- 优先最小可运行演示（MVP）而非完整功能面；
- 每个关键假设都应对应一个可观测验证信号；
- Python 多文件项目：**每个文件单独 writeOutputToFile 阶段**，禁止 setup_project.py 一次性生成全仓库；
- Excel 样本：create_sample 与所有 stage_test_run_* 必须使用同一 input.xlsx 路径与 ASIN/SKU/TargetPrice/Stock 列名；
- Python 验证阶段 MUST 使用 python3 -m venv .venv + .venv/bin/python -m pip（禁止 pip install && python 裸命令）。
- 交付闭环（硬性，见 ARTIFACT 对齐规则 11）：任务声明了输出文件（CSV/报告/导出）时，必须包含 writer 产出阶段 + main 入口阶段 + 末尾端到端集成阶段（跑 main 并断言产物存在/行数/必需列名）；不得止步于 analyzer 等中间模块。
- 验证覆盖（硬性，见规则 12）：最后一个核心模块也必须有 code-runner check；且至少一个 check 为跨模块集成（用上游真实输出喂下游），以暴露字段名/容器类型/模块名契约错位。
- 数据契约（硬性，见规则 13）：决策记录必须含 DATA_SCHEMA，钉死每个跨模块 dict 的字段名+类型+枚举（含「成功」枚举字面量，如 query_status=="success"）；reader/fetcher/analyzer/writer/mock_data 全部复用同一组键名，禁止 availability/stock_status、sku/tk_sku、success/OK 漂移。
- 共享样例源（硬性，见规则 14）：create_sample 与 mock_data 必须共享同一 ASIN/SKU 列表；mock_data 阶段 input.sources 须引用 create_sample 阶段输出（或反之）。
- 集成正确性断言（硬性，见规则 15）：末尾集成阶段必须断言「≥1 行 query_status=success + ≥1 行有效告警/正常」，而非仅 len(rows)>=N。`, ctx);
  }

  if (taskType === 'debug') {
    return appendCodebaseContextBlock(`${base}

${DEBUG_CONSTRAINT_TEXT}

补充要求：
- 优先 AFK 链路，尽量使用可执行阶段表达复现与回归验证；
- 若必须 HITL，需在阶段描述中写明无法自动化的原因；
- 若复现/验证涉及 Python 脚本或 pip 依赖，code-runner 须遵守 PYTHON INFRA（venv + python3 -m pip，见 prototype 约束）。`, ctx);
  }

  if (taskType === 'document' || taskType === 'other') {
    return appendCodebaseContextBlock(`${base}

${PYTHON_CODE_RUNNER_CONSTRAINT_TEXT}

补充要求（${taskType}）：
- 通常 2～6 个阶段；可用 llm-text + code-runner/file-write。`, ctx);
  }

  if (taskType === 'refactor') {
    return appendCodebaseContextBlock(`${base}

${REFACTOR_CONSTRAINT_TEXT}

补充要求：
- 架构决策阶段同样遵循三层构成：§7.5 原文 + grill-with-docs 补充层 + §4.4 输出约束；
- 必须显式给出“行为等价”验证路径（test_run 或 code-runner）；
- 若 meta.isGreenfield !== true，优先插入 stage_zoom_out(file-read) 产出 moduleMap，再由 decide/impl 消费。`, ctx);
  }

  if (taskType !== 'software') {
    return appendCodebaseContextBlock(base, ctx);
  }

  return appendCodebaseContextBlock(`${base}

${buildSoftwareGeneratorAppendix(ctx)}`, ctx);
}

export function buildWorkflowGeneratorPrompt(taskType: string, ctx?: WorkflowGeneratorContext): string {
  if (isAutoTaskType(taskType)) {
    return buildUnifiedAutoTaskTypePrompt(ctx);
  }
  return buildWorkflowGeneratorPromptForType(taskType, ctx);
}
