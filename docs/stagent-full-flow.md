# Stagent 全流程图（合成单图 · 含理想/未开发部分）

> 面向专业技术人员的单张全流程图。综合**已核实实现**（`docs/task-lifecycle.md`、`STAGENT-PRD.md` §4、`packages/stagent-core/src/*`）
> 与**理想/路线图**（ADR-0005~0009、`live-findings-2026-06-15.md`、`orchestration-plan.md`、借鉴分析）。
>
> 图例：✅ 绿=已实现并核实 ｜ 🚧 黄=进行中（有 PR/子任务） ｜ 💡 紫虚线=理想/未开发 ｜ 蓝=贯穿治理层。
> 实线=主控制流；虚线=治理/挂接关系。

```mermaid
flowchart TB
  classDef done fill:#d4edda,stroke:#28a745,color:#155724;
  classDef inflight fill:#fff3cd,stroke:#ff9800,color:#7a5b00;
  classDef ideal fill:#ece7f6,stroke:#6f42c1,color:#3d2c6d,stroke-dasharray:4 3;
  classDef gov fill:#e7f1ff,stroke:#0d6efd,color:#084298;

  IN(["用户输入：需求 + 上下文"]):::done

  %% ① 预执行
  subgraph PRE["① 预执行 — WorkflowInstance.status = idle"]
    direction TB
    POL["polishUserTask 润色<br/>TaskPolishPrompt"]:::done
    CLA["clarifyStart / questionBefore 澄清·grill<br/>GrillLoopPolicy（Charter 预填）"]:::done
    ROU["path-router → meta.workflowTemplate<br/>ScenarioRouter（greenfield/brownfield/express/debug/arch_review）"]:::done
    GEN["generateWorkflow → WorkflowDefinition<br/>LLM JSON 或 plan-skeleton/expandGreenfieldPythonSkeleton"]:::done
    VAL["post-parse 校验<br/>Rule20Verify + PlanCompletenessGate + 结构修复"]:::done
    CMP["plan-compile @startExecution<br/>applySoftwarePipeline：venv/npm·self-heal·smoke·delivery 注入 + normalize"]:::done
  end

  CON{"② confirm 确认页<br/>CanApprovePlan / autoApprovePlan"}:::done

  IN --> POL --> CLA --> ROU --> GEN --> VAL --> CMP --> CON
  CON -->|"reject / 重生成"| GEN

  %% ③ 执行循环
  subgraph EXEC["③ 执行循环 — status = running（WorkflowExecutorLoop）"]
    direction TB
    SCHED["调度：线性 currentStageIndex++<br/>或 DAG WorkflowDag.findAllReadyStageIndices + pickDagExecutionBatch"]:::done
    PRELUDE["stage prelude：skipIf → questionBefore → pre-gates"]:::done

    subgraph SLICE["每个 TDD 垂直切片（stage-runners/executeStageStep）"]
      direction TB
      DEC["stage_decide_*<br/>决策：decisionArtifacts + behaviorSpec（DecisionRecordVerify）"]:::done
      DECP["prevention-at-decide：净化 pipeline.exports<br/>禁跨切片符号/模块名/占位（子任务 1b）"]:::inflight
      TW["stage_test_write_*<br/>写测试（异族出题人 LLM_MODEL_TEST_WRITE）"]:::done
      MC["module-contract / forward-slice import 门<br/>ModuleContractLint / ForwardSliceImportLint"]:::done
      RG{"GATE_ID_RED_GREEN_PRE_IMPL<br/>配对测试须先 RED"}:::done
      RGW["already GREEN → warn / hard block<br/>（tdd.redGreenGate）"]:::done
      IMP["stage_impl_*<br/>实现（ImplOutputGuard 防空心输出）"]:::done
      SCORE["post-stage：OutputQualityScorer + 静态分析门"]:::done
      TR["stage_test_run_*<br/>跑测试（pytest / vitest，按语言）"]:::done
      FIX{"测试红？"}:::done
      FIXS["stage_fix_if_failed_*<br/>修复链（rewind 重跑）"]:::done
      RP["fix 预算耗尽 → runtime-replan 插补救阶段"]:::done
    end

    SMK{"smoke 阶段（A1，PR #11）：真启动主入口<br/>verify-smoke-output 断言产出非平凡"}:::done
  end

  CON -->|"approve / approveDecision"| SCHED
  SCHED --> PRELUDE --> DEC --> DECP --> TW --> MC --> RG
  RG -->|"RED ok"| IMP
  RG -->|"already GREEN"| RGW
  IMP --> SCORE --> TR --> FIX
  FIX -->|"green"| SMK
  FIX -->|"red"| FIXS --> TR
  FIXS -.->|"exhausted"| RP --> TR
  SMK -->|"fail → 入修复回路"| FIXS
  SMK -->|"pass"| DLV

  %% ④⑤ 交付 + 完成
  DLV["④ stage_delivery_wrapup → DELIVERY.md<br/>blockDeliveryOnTestFailure（测试未过则拦交付）"]:::done
  QR["⑤ workflowCompleted → buildQualityReportPayload<br/>AFK 验收 / flaky 检测"]:::done
  EXP["落盘：.wf-state.json + experiences.jsonl + .wf-failures.jsonl"]:::done
  DLV --> QR --> EXP

  %% HITL（贯穿）
  HITL{"HITL 暂停？<br/>AdaptiveHITLPolicy + ConfidenceScorer"}:::done
  SCORE -.-> HITL
  HITL -.->|"paused → approve / approveDecision"| SCHED

  %% ⑥ 治理层（已实现）
  subgraph GOV["⑥ 贯穿治理层（已实现）"]
    direction TB
    CH["Charter 章程：约束 / auto-answer / provenance / 升级"]:::gov
    QG["QualityGate 注册表（确定性 lint/repair）<br/>generate / pre-stage / post-stage"]:::gov
    ROUTE["难度路由（ADR-0006）：per-role 模型 env 解耦 + 分角色成本"]:::gov
    LANG["语言适配 test-quality：python ✅ / node ✅<br/>LanguageTestQualityAdapter + selectTestQualityAdapter"]:::gov
  end
  CH -.-> CLA
  CH -.-> DEC
  QG -.-> MC
  QG -.-> SCORE
  ROUTE -.-> DEC
  ROUTE -.-> TW
  LANG -.-> TR

  %% ⑦ 理想 / 未开发
  subgraph IDEAL["⑦ 理想 / 未开发（路线图）"]
    direction TB
    G1["宪法门 constitution：不可变治理文档每 stage 强制对照（增强 Charter）"]:::ideal
    SEC["安全审查阶段"]:::ideal
    Q1["best-of-N + 门控择优：难切片并行采样，按 Strict QA 选通过者"]:::ideal
    Q2["对抗式审查：异族/更强模型独立挑 diff 回喂"]:::ideal
    Q3["难度路由自动升级：低置信/高复杂自动切强模型"]:::ideal
    L2["规则候选自动晋升：复发 review 发现 → 确定性 QualityGate"]:::ideal
    NODE["Node/TS 全交付：PR-4 栈引导 → PR-5 T6n live → PR-6 zip + 解压可启动 DoD"]:::ideal
    O1["Sprint 循环：多工作流编排 + 回顾 retrospective + 询问下一 Sprint"]:::ideal
    O2["并行多实例 + git worktree 写入隔离 + merge-tree 冲突预检"]:::ideal
    O3["CLI host（pilot，bun 单二进制，类 codex）；Electron GUI 可选"]:::ideal
  end
  G1 -.->|"挂接 decide"| DEC
  SEC -.->|"挂接 confirm/review"| CON
  Q1 -.->|"挂接 impl 难切片"| IMP
  Q3 -.->|"挂接 impl"| IMP
  Q2 -.->|"挂接 review/门"| SCORE
  L2 -.->|"复发发现固化为门"| QG
  NODE -.->|"挂接 test_run/交付"| TR
  O2 -.->|"挂接执行调度"| SCHED
  O3 -.->|"共用 @stagent/core 引擎"| EXEC

  %% Sprint 循环回边（理想）
  QR -.->|"💡 询问是否进入下一 Sprint"| O1
  O1 -.->|"💡 下一 Sprint 需求"| IN
```

---

## 节点状态与依据速查

| # | 阶段 / 能力 | 状态 | 关键模块 / 依据 |
|---|------|------|------|
| ① | 润色 / 澄清·grill / path-router / 计划生成·校验·编译 | ✅ | `TaskPolishPrompt`、`GrillLoopPolicy`、`ScenarioRouter`、`WorkflowGenerationRunner`、`plan-skeleton/*`、`Rule20Verify`、`StartPreconditions`、`disk-bootstrap/applySoftwarePipeline.ts` |
| ② | confirm 确认页 / autoApprovePlan | ✅ | `CanApprovePlan`、`GeneratedWorkflowGate` |
| ③ | 执行循环（线性 / DAG ready 批次） | ✅ | `WorkflowExecutorLoop`、`executor-loop/DagWaveScheduler`、`WorkflowDag.ts` |
| ③ | TDD 切片 decide→test_write→impl→test_run | ✅ | `expandGreenfieldPythonSkeleton`、`stage-runners/executeStageStep` |
| ③ | RED-GREEN / module-contract / forward-slice | ✅ | `GATE_ID_RED_GREEN_PRE_IMPL`、`python-contract/{ModuleContractLint,ForwardSliceImportLint}` |
| ③ | fix_if_failed / runtime-replan | ✅ | `workflow-self-heal/*`、`runtime-replan/*` |
| ③ | smoke 阶段（真启动+断言非平凡+fix 回路） | ✅ PR #11 | `disk-bootstrap/smokeStage.ts`、`verify-smoke-output.mjs`、ADR-0008 |
| ④⑤ | delivery_wrapup / blockDeliveryOnTestFailure / qualityReport / experiences | ✅ | `deliveryWrapupStage.ts`、`quality-report/buildQualityReportPayload`、`WorkflowExperienceStore` |
| ⑥ | Charter / QualityGate / HITL / 难度路由(ADR-0006) / 语言适配(py+node) | ✅ | `charter/*`、`QualityGateIds`、`AdaptiveHITLPolicy`+`ConfidenceScorer`、`scripts/headless/lib/llm-config.mjs`、`language-adapter/*` |
| ③ | prevention-at-decide（pipeline.exports 契约净化） | 🚧 1b | `orchestration-plan.md` 子任务 1b |
| ⑥ | mvp-acceptance Node 模式（requireDirTs） | 🚧→✅ PR #15 | `scripts/headless/lib/mvp-acceptance.mjs` |
| ⑦ | Node 栈引导 / T6n live / zip 交付 | 💡 | ADR-0005 PR-4/5/6 |
| ⑦ | 规则候选自动晋升（学习闭环） | 💡 | 借鉴分析（Totem/PR-Distiller）；现仅 few-shot |
| ⑦ | best-of-N 门控择优 / 对抗审查 / 难度自动升级 | 💡 | 借鉴分析 + 研究（采样+可靠验证器） |
| ⑦ | 宪法门 constitution / 安全审查 | 💡 | 借鉴分析（Spec-Kit constitution） |
| ⑦ | Sprint 循环 / 并行多实例隔离 / CLI host | 💡 | 原始流程图 + worktree 研究 + 产品定位 |

> 核心设计原则（已被实测验证，ADR-0008）：**门的强度比模型档位更决定产物质量**；
> 评审/修复循环必须绑定**可执行外部验证器**（测试 / 真实运行 / smoke），无锚点自检会"假性收敛"（业界自我纠正研究一致结论）。
