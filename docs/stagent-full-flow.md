# Stagent 全流程图（含理想/未开发部分）

> 说明：本图综合**已核实的实现**（`docs/task-lifecycle.md`、`docs/STAGENT-PRD.md` §4、`packages/stagent-core/src/*` 源码）
> 与**理想/路线图**（ADR-0005~0009、`docs/live-findings-2026-06-15.md`、`docs/orchestration-plan.md`、借鉴分析）。
>
> 图例：✅ 已实现并核实 ｜ 🚧 进行中（已有 PR / 子任务） ｜ 💡 理想/未开发。

---

## 1. 端到端主流程（已实现 ✅ + 进行中 🚧）

```mermaid
flowchart TB
  classDef done fill:#d4edda,stroke:#28a745,color:#155724;
  classDef inflight fill:#fff3cd,stroke:#ff9800,color:#7a5b00;
  classDef ideal fill:#ece7f6,stroke:#6f42c1,color:#3d2c6d,stroke-dasharray:4 3;

  IN(["输入需求 + 上下文"]):::done

  subgraph PRE["预执行 — instance status: idle"]
    direction TB
    POL["polishUserTask 润色"]:::done
    CLA["clarifyStart / questionBefore<br/>澄清 · grill（charter 预填）"]:::done
    ROU["path-router 选 workflowTemplate<br/>greenfield / brownfield / express / debug / arch_review"]:::done
    GEN["generateWorkflow<br/>LLM 计划 或 plan-skeleton 编译器"]:::done
    VAL["计划校验<br/>Rule20 + plan-completeness + 结构修复"]:::done
    CMP["plan-compile @start<br/>disk-bootstrap 注入（venv/npm · self-heal · smoke · delivery）+ normalize"]:::done
    CON{"confirm 确认页<br/>HITL 审核 / autoApprovePlan"}:::done
  end

  IN --> POL --> CLA --> ROU --> GEN --> VAL --> CMP --> CON

  subgraph EXEC["执行循环 — status: running（线性 currentStageIndex++ 或 WorkflowDag ready 批次）"]
    direction TB
    PICK["调度：取下一个 ready 阶段"]:::done

    subgraph SLICE["每个 TDD 垂直切片"]
      direction TB
      DEC["stage_decide_*<br/>决策（decisionArtifacts / behaviorSpec）"]:::done
      DECP["🚧 prevention-at-decide：pipeline.exports 契约净化<br/>（禁跨切片符号/模块名/占位）"]:::inflight
      TW["stage_test_write_*<br/>写测试（异族出题人模型）"]:::done
      MC["module-contract / forward-slice import 门"]:::done
      RG{"RED-GREEN 门：配对测试须先红"}:::done
      IMP["stage_impl_* 实现"]:::done
      TR["stage_test_run_* 跑测试"]:::done
      FIX{"红？→ stage_fix_if_failed_* 修复链"}:::done
      RP["预算耗尽 → runtime-replan 插补救阶段"]:::done
    end

    SMK["smoke 阶段（A1）：真启动主入口<br/>+ 断言产出非平凡 → 失败入 fix 回路"]:::done
    DLV["stage_delivery_wrapup → DELIVERY.md<br/>blockDeliveryOnTestFailure"]:::done
  end

  CON -->|approve / decision| PICK
  PICK --> DEC --> DECP --> TW --> MC --> RG
  RG -->|red ok| IMP --> TR --> FIX
  FIX -->|green| SMK
  FIX -->|still red| RP --> TR
  RG -->|already green| RG2["warn / hard block"]:::done
  SMK --> DLV
  DLV --> FIN(["workflowCompleted → qualityReport（AFK 验收 / flaky 检测）→ experiences.jsonl"]):::done

  CON -->|reject / 修改| GEN
```

---

## 2. 贯穿式治理层（已实现 ✅，作用于上图各阶段）

```mermaid
flowchart LR
  classDef done fill:#d4edda,stroke:#28a745,color:#155724;
  CH["Charter 章程：约束 / auto-answer / provenance / 升级（ADR/约束违规）"]:::done
  QG["QualityGate 注册表（确定性 lint/repair）<br/>generate-time / pre-stage / post-stage"]:::done
  HITL["HITL：AdaptiveHITLPolicy + ConfidenceScorer<br/>approve / approveDecision + DecisionLint"]:::done
  ROUTE["难度路由（ADR-0006 已落地）：per-role 模型 env 解耦<br/>decision / test-write / integration 独立 + 分角色成本"]:::done
  LANG["语言适配（test-quality）：python ✅ / node ✅（adapter+seam+按语言注入）"]:::done
  PERSIST["状态落盘：.wf-state.json + globalState；experiences.jsonl / .wf-failures.jsonl"]:::done

  CH --- QG --- HITL --- ROUTE --- LANG --- PERSIST
```

---

## 3. 理想 / 未开发部分（💡 路线图，标注挂接点）

```mermaid
flowchart TB
  classDef done fill:#d4edda,stroke:#28a745,color:#155724;
  classDef inflight fill:#fff3cd,stroke:#ff9800,color:#7a5b00;
  classDef ideal fill:#ece7f6,stroke:#6f42c1,color:#3d2c6d,stroke-dasharray:4 3;

  subgraph NODE["Node/TS 一等交付（ADR-0005）"]
    direction TB
    N1["✅ nodeTestQualityAdapter + seam + 按语言注入（PR-1/2/3）"]:::done
    N2["✅ mvp-acceptance Node 模式 requireDirTs（PR #15）"]:::done
    N3["💡 PR-4 Node 栈引导：npm install + tsc --noEmit + vitest run 作 test_run"]:::ideal
    N4["💡 PR-5 T6n 确定性 live tier（CRUD+状态机+管道 · TS）"]:::ideal
    N5["💡 PR-6 zip 交付：deliverable/&lt;name&gt;.zip + run.sh + 解压可启动 DoD"]:::ideal
    N1 --> N2 --> N3 --> N4 --> N5
  end

  subgraph LEARN["持续学习闭环（最高价值借鉴）"]
    direction TB
    L1["✅ experiences.jsonl + FailurePatternAnalyzer（喂下次生成 few-shot）"]:::done
    L2["💡 规则候选自动晋升：复发 review 发现 → 确定性 QualityGate<br/>（Totem/PR-Distiller 式，needs_review→active 置信度晋升）"]:::ideal
    L1 --> L2
  end

  subgraph QUALITY["质量放大器（便宜模型逼近强模型）"]
    direction TB
    Q1["💡 best-of-N + 门控择优：难切片并行采样 N 次，按 Strict QA 选通过者<br/>（研究支持：采样+可靠验证器 优于无锚点自检）"]:::ideal
    Q2["💡 对抗式审查：异族/更强模型独立挑 diff → 回喂（只加分，不替代确定性门）"]:::ideal
    Q3["💡 难度路由自动升级：低置信/高复杂/架构切片自动切强模型"]:::ideal
  end

  subgraph GOV["治理增强"]
    direction TB
    G1["💡 宪法门（constitution）：不可变治理文档，每 stage 强制对照（增强 Charter）"]:::ideal
    G2["💡 安全审查阶段"]:::ideal
  end

  subgraph ORCH["编排 / 产品形态"]
    direction TB
    O1["💡 Sprint 循环：多工作流编排 + 回顾(retrospective) + 询问是否进入下一 Sprint"]:::ideal
    O2["💡 并行多任务执行：多实例 + git worktree 写入范围隔离 + 合并前 merge-tree 冲突预检"]:::ideal
    O3["💡 CLI host（pilot，bun 单二进制，类 codex）；Electron GUI 作可选"]:::ideal
  end

  HOOK_DEC["挂接点：decide 阶段"]:::done -.-> G1
  HOOK_IMP["挂接点：impl 难切片"]:::done -.-> Q1
  HOOK_REV["挂接点：review/门"]:::done -.-> Q2
  HOOK_FIN["挂接点：workflowCompleted"]:::done -.-> L2
  HOOK_FIN -.-> O1
  HOOK_EXEC["挂接点：执行调度"]:::done -.-> O2
```

---

## 4. 节点状态与依据速查

| 阶段 / 能力 | 状态 | 依据 |
|------|------|------|
| 润色 / 澄清·grill / path-router / 计划生成·编译 / confirm | ✅ | `docs/task-lifecycle.md`、`WorkflowGenerationRunner`、`plan-skeleton/*`、`StartPreconditions`、`disk-bootstrap/applySoftwarePipeline.ts` |
| 执行循环（线性 / DAG ready 批次） | ✅ | `WorkflowExecutorLoop`、`executor-loop/DagWaveScheduler`、`WorkflowDag.ts` |
| TDD 切片：decide→test_write→impl→test_run | ✅ | `expandGreenfieldPythonSkeleton`、`stage-runners/*` |
| RED-GREEN 门 / module-contract / forward-slice | ✅ | `RedGreenGate/Fsm`、`python-contract/*`、`plan-completeness/moduleContractChecks` |
| fix_if_failed / runtime-replan | ✅ | `workflow-self-heal/*`、`runtime-replan/*` |
| smoke 阶段（真启动+断言非平凡+fix 回路） | ✅ | A1 / PR #11、`disk-bootstrap/smokeStage.ts`、ADR-0008 |
| delivery_wrapup / blockDeliveryOnTestFailure | ✅ | `disk-bootstrap/deliveryWrapupStage.ts` |
| qualityReport / experiences | ✅ | `quality-report/buildQualityReportPayload`、`WorkflowExperienceStore` |
| Charter / QualityGate / HITL / 难度路由(ADR-0006) / 语言适配 | ✅ | `charter/*`、`QualityGateIds`、`AdaptiveHITLPolicy`、`scripts/headless/lib/llm-config.mjs`、`language-adapter/*` |
| prevention-at-decide（decide 契约净化） | 🚧 1b | `docs/orchestration-plan.md` 子任务 1b |
| mvp-acceptance Node 模式（requireDirTs） | 🚧→✅ | PR #15 |
| Node 栈引导 / T6n live / zip 交付 | 💡 | ADR-0005 PR-4/5/6 |
| 规则候选自动晋升（学习闭环） | 💡 | 借鉴分析（Totem/PR-Distiller）；现仅 few-shot |
| best-of-N 门控择优 / 对抗审查 / 难度自动升级 | 💡 | 借鉴分析 + 研究（采样+验证器） |
| 宪法门 / 安全审查 | 💡 | 借鉴分析（Spec-Kit constitution） |
| Sprint 循环 / 并行多实例隔离 / CLI host | 💡 | 原始流程图 + worktree 研究 + 产品定位 |

> 核心设计原则（已被实测验证，见 ADR-0008）：**门的强度比模型档位更决定产物质量**；
> 评审/修复循环必须绑定**可执行外部验证器**（测试 / 真实运行 / smoke），无锚点自检会"假性收敛"。
