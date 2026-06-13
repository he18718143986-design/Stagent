# 面试深聊提纲 · 按 JD 关键词组织（Stagent 项目素材）

> 用法：每个关键词下分「一句话主张 → 项目素材（可验证落点）→ 深聊展开 → 预判追问」。
> 面试时先抛主张，等面试官追问再展开素材；不要一次性倒完。
> 事实源：`docs/STAGENT-PRD-ENGINEER.md`、`docs/t4-live-iteration-log.md`（Run #1–#53）、`packages/stagent-core/` 源码。

---

## 0. 三十秒项目电梯陈述（开场必备）

**Stagent**：一个 Skill-native 的 **AFK 软件开发引擎（Agent Harness）**。
把需求编译为机器可读的 stage DAG（`WorkflowDefinition`），按切片执行 RED→GREEN TDD 链，
用「确定性 Gate + 契约/行为 SSOT prompt 注入 + 有界重试/replan」三件套约束 LLM 方差，
配套三层回归金字塔（单测 → mock headless → Live LLM）和 50+ 次 Live 迭代日志。
压测任务 T4：用引擎自动开发一个 Python 量化交易系统（5 模块：indicators / signals / risk / broker / system）。

一句话定位：**我不是用 Agent 写了个应用，我是在造约束 Agent 的笼子，并用真实任务反复压测这个笼子。**

---

## 0b. 方向依据（业界证据，2026-06 检索）

> 用途：被问「为什么相信 AFK + 规格驱动 + Gate 这个方向」时引用；也证明自己持续跟踪业界。
> 要点：Stagent 的设计是在交付实践中**独立收敛**到这些结论的，与业界趋势互为印证，而非跟风复刻。

**1. 规格驱动开发（SDD）已成主流方法论** —— 对应 Stagent「需求编译为机器可读 stage DAG」：

- **GitHub Spec Kit**（2025-08 发布，GitHub 官方，11 万+ stars，220+ 贡献者，30+ Agent 集成）：核心流程 Spec → Plan → Tasks → Implement，主张「规格是可执行的真源（executable source of truth），每个阶段产出喂给下一阶段的结构化产物」——与 Stagent 的 澄清 → Plan Generate → Plan Compiler → Execute 同构。<https://github.com/github/spec-kit>
- **AWS Kiro**：原生 SDD 的 Agentic IDE，EARS 需求标记 + 事件驱动 hooks。企业实证（VentureBeat）：Kiro 团队自举开发将功能周期从 2 周压到 2 天；AWS 某 18 个月、原定 30 人的重构项目 6 人 76 天完成；Amazon Alexa+/Prime Video/Fire TV 等多团队采用。<https://venturebeat.com/orchestration/agentic-coding-at-enterprise-scale-demands-spec-driven-development>
- **Martin Fowler 站点 SDD 三工具对比**（Kiro / spec-kit / Tessl）：指出当前工具多为 spec-first，「spec-anchored over time（规格长期锚定）」仍是开放问题——Stagent 的 decisionRecord + behaviorSpec 全链路注入正是朝 spec-anchored 走的尝试，可作为差异化论点。<https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html>

**2. Harness Engineering 被确认为行业宏观趋势** —— 对应 Stagent 的 Gate / SSOT / 重试结构：

- **Thoughtworks 技术雷达 Vol 34（2026-04）**将 harness engineering 列为定义性宏观趋势：「行业正从实验走向对可重复性与稳定性的追求；Agent 可靠性已成为工程组织最关键的议题之一」——这句几乎可以直接当 Stagent 的立项陈述。
- **Martin Fowler《Harness engineering for coding agent users》**：提出 feedforward controls（guides，行动前引导）+ feedback controls（sensors，行动后检测）双层框架——分别对应 Stagent 的 SSOT prompt 注入（②）与确定性 Gate（①）；文中「计算型传感器便宜到可以每次变更都跑」即 hard lint gate 的论据。<https://martinfowler.com/articles/harness-engineering.html>
- **Plan-Execute-Verify（PEV）模式**（Augment Code 等）：分离规划/执行/验证、验证失败转化为结构化纠正上下文而非静默丢弃——后者正是 Stagent「反馈信息密度」原则（③）的同义表述。<https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents>
- **LangChain《The Anatomy of an Agent Harness》**：Agent = Model + Harness；长程任务依赖 durable state、planning、verification loops——对应 Stagent 持久层（.wf-state / decisionRecord 落盘产物通信）。文中也提出关键反方观点（见下）。<https://www.langchain.com/blog/the-anatomy-of-an-agent-harness>

**3. 学术侧印证「评估驱动的 harness 迭代」** —— 对应 Stagent 的迭代日志方法论：

- **arXiv《Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses》（2026）**：核心洞察是 harness 进化的瓶颈在 observability 而非模型能力；提出「每次修改附带可证伪的预测，下一轮评估验证、无效则回滚」——与 Stagent「Live 失败 → RCA → 改 gate/prompt → Live 复验 → 写入迭代日志」的闭环同构，且该论文把人工闭环自动化了（可作为 Stagent 平台演进 G11 的下一步方向聊）。<https://arxiv.org/abs/2604.25850>

**4. 预判反方观点并备好应答**：

- *「模型变强后 harness 会被吸收进模型」*（LangChain 文中自承）：应答——harness 今天确实在补模型短板，但「交付需要外部可验证判据」不随模型能力消失；模型变强改变的是 gate 命中率而非 gate 的必要性，且 LangChain 同文也承认良好环境/工具/验证回路「让任何模型更高效，与基础智能无关」。
- *「SDD 工具已有 Spec Kit/Kiro，Stagent 价值何在」*：应答——Spec Kit 是 prompt 模板 + 人工 slash command 串联（spec-first），Stagent 是引擎级编译 + 确定性 Gate + 机读行为规格（朝 spec-anchored + AFK 走）；差异化在「机器可验收」而非「结构化提示」。

---

## 1. Agent Harness / Harness Engineering（JD 最高权重）

**主张**：Harness 的本质是「LLM 负责文本生成，引擎负责一切可确定性化的事」，且边界要画得越狠越好。

**素材**：
- Agent vs 引擎边界（PRD-ENGINEER §2.4）：LLM 只产 decide 散文 / test / impl / fix 文本；引擎负责 DAG 调度、落盘路径、Gate、venv/pip、pytest 调用、fix 次数上限、prompt 注入。
- 四条根治原则（§8.1，原创方法论）：
  1. **Gate** — 确定性检测，hard 阻断，保证同样烂的输入每次在同一点失败（可复现 > 偶尔成功）；
  2. **SSOT** — prompt 注入唯一契约，降低漂移概率；
  3. **反馈信息密度** — 重试 prompt 必须含可操作上下文，决定重试是「修正」还是「再赌」；
  4. **重试/升级结构** — 有界同 stage 重写 → fix 链（max 2）→ testfix replan。
- 失败模式 → 机制对照表（§8.2）：每个 Live 失败模式对应一个仓库落点（`TestQualityLint`、`ModuleContractLint`、`ConfigContractLint`、`smokeDataBootstrap`、`blockedPipDependencies`…）。

**深聊展开**：
- 「③ 与 ① 同等重要」的实证：Run #23→#24，testfix replan 注入 impl 文件全文之前，LLM 反复虚构 `SimBroker(...)` 构造签名——因为重试 prompt 里根本看不到实现代码。加 gate 不如先问「重试时模型能看到什么」。
- 「SSOT 的上游也要 Gate」：Run #25，decide 产物本身低质（confidence 0.1、缺章节）会污染所有下游注入，所以 `DecisionLintGate` 在源头硬拒 + harness 同 stage 重试（≤2 次）。

**预判追问**：
- *Q: 为什么不让 fix 改 test？* → TDD 纪律（EQ-4 决议）：fix 链改 test 等于让模型自己批改自己的卷子；test 的问题必须回到 test_write 阶段用 gate + 同 stage 重试解决（P0(b)）。
- *Q: gate 越多越好吗？* → 不是。gate 是确定性回路，但每个 hard gate 都要配「拦了之后能改」的重试路径（原则④），否则只是把失败换了个位置。

---

## 2. 对模型行为的品味与判断力（JD 原文「有品味有判断力」）

**主张**：模型行为要靠失败模式分类学来理解，不靠印象。我有一份 50+ Run 的实证日志，每条失败都归因到「结构性 vs 行为性」并配机制。

**素材**（按失败类型背 3–4 个典型 Run）：
- **测试反模式**：Run #22 — LLM 写出 `sys.modules['indicators']=…` 劫持被测包 + 仅 `is not None` 的弱断言 → impl 已绿仍 pytest 红，而 fix 链不可改 test → 死锁。根治：post test_write hard gate（`testQualityLint`）+ 同 stage 重写。
- **契约漂移**：Run #18 `from __init__ import`、Run #21 拦截 `SignalGenerator` 幻觉符号、Run #44 exports 混入 `index_sh`（市场数据名被当成模块导出）。
- **行为语义漂移**（最深的一层）：Run #50 — `generate_bear_signal()` 返回 None，CCI AND 链条件真值与 fixture 不一致；Run #45 — `_set_ideal_*` helper 覆盖顺序导致测试假红。**结构 gate 全绿但行为不对**，这推动了 behaviorSpec 的设计。
- **关键洞察**：Run #31 之后结构性卡点显著下降，失败重心从「import/export 错」迁移到「语义/行为不对齐」——harness 成熟度的标志就是失败类型的迁移。

**深聊展开**：
- 「单次 strict 绿不可证伪（可能是运气）」→ 产品就绪用成功率口径：N=5 连跑 strict ≥3。对 LLM 方差的统计自觉。
- mock headless 假绿问题：全量单测 pass ≠ Live 绿，所以 G11 强制 Live 回归才算数。

**预判追问**：
- *Q: 这些失败模式换个模型还存在吗?* → 结构性失败（弱断言、mock 劫持）是训练分布带来的普遍倾向，强模型频率更低但不为零；harness 的价值就是让方差不传导到交付。可顺势聊不同模型档位下 gate 命中率的差异。

---

## 3. Planning / AgentLoop / Tool Use

**主张**：Planning 不能只靠 LLM 自由发挥——「LLM 生成 + 确定性编译」两段式才能既保语义又保结构。

**素材**：
- **Plan Compiler**（`plan-compiler/compilePlan.ts`）：LLM 生成后做确定性变换——`sanitizeInfraStages`、`lintArtifactGraph`（artifact 图 0 误报）、plan-completeness hard gate（Run #6–#8 根治「计划里没有 test_run」）。
- **骨架展开**（`expandGreenfieldPythonSkeleton.ts`）：模板定结构、LLM 填语义，把「13+ stage DAG 全靠 LLM 一次吐对」的方差砍掉（§14 过渡档）。
- **AgentLoop**：切片级 RED→GREEN 状态机 `decide → stub → test_write → [gate] → verify_imports → impl → [gate] → test_run → fix(bounded) → replan`，由 `StageStepDriver` 驱动，fix 上限 + `planDeterministicReplan`。
- **Tool Use**：llm-text / code-runner / file-write 三类执行器；`SandboxExecutor`——内存 512MB、超时 60s、`networkAllowed=false` 走 proxy 黑洞（127.0.0.1:9）阻断出网并计数 `blockedNetworkAttempts`、`writeablePathGlobs` 限制写路径。
- **runtime-replan**：执行期发现计划错误时的确定性重规划，而非整盘推倒。

**预判追问**：
- *Q: 为什么不用现成框架（LangGraph 等）？* → 核心价值在 Gate/SSOT/重试这层质量机制和与 TDD 工作流的深度耦合，通用框架只给 DAG 调度——那是这个项目里最薄的一层。

---

## 4. Prompt Engineering

**主张**：Prompt 不是手艺活，是工程问题：关键信息必须有唯一来源（SSOT）并机器注入，禁止靠模型「记得」。

**素材**：
- **注入链**（`LlmTextInvokeStep.ts`）：每个 stage 的 system prompt 由引擎按规则拼装后缀——`buildSliceContractExportsPromptSuffix`（exports 真源覆盖骨架静态示例）、`buildTestGreenBridgePromptSuffix`（impl 事后读已落盘 test 全文）、`buildCrossModulePatchExportsPromptSuffix`（main 跨模块 patch 契约）、`buildConfigYamlAccessGuide`（禁止发明 config 顶层键）。
- **分场景反馈 prompt**：gate 重试（`buildMutateGateRetrySystemAppend`）与 testfix replan（`buildTestRewriteImplBridgePromptSuffix`）各自携带该场景能用上的上下文——通用「请重试」是无效 prompt。
- **教训案例**：契约 prompt 与骨架静态示例漂移（两处写了不一样的 exports 示例）→ runtime SSOT 覆盖静态示例（Run #22）。Prompt 里任何重复信息都是漂移源。

**预判追问**：
- *Q: prompt 改动如何回归？* → golden fixture 离线回归（Run #48/#52 真实产物快照，`run52-golden.json`，零 API 消耗）+ 单测断言注入后缀内容 + Live 复验三层。

---

## 5. Context Engineering（含 KV Cache 话术）

**主张**：上下文是预算问题：总量、分配比例、截断策略都应是代码里的常量，不是每次拼到爆。

**素材**（`InputTokenBudgets.ts`，全部可现场打开）：
- 总额 60k；输出预留 8k；单输入截断 3k / 阶段输入总额 12k。
- 可用输入按比例分配：决策记录 0.35 / 全局决策 0.25 / 用户输入 0.15 / 代码库 0.10。
- 超预算项走**引用式注入**（给路径让模型按需读）而非 inline 全文（§9 风险表：Token 截断致后期 stage 劣化）。
- 上下文分层（§2.1 持久层）：`.stagent/instances`（实例态）/ `decisionRecord`（任务态）/ `CONTEXT.md` + ADR（项目态）/ `experiences.jsonl`（跨任务态）。

**KV Cache 应答要点**（项目未直接做，用设计语言补）：
- prompt 拼装顺序天然影响 cache 命中：stable prefix（骨架 system prompt）在前、变动后缀（SSOT 注入、重试反馈）在后，正是 KV cache 友好结构；
- 同 stage 重试复用同一 prefix，只追加反馈段——可对照 Anthropic/DeepSeek 的 prompt caching 计价说明这个设计省在哪。
- headless 已做 token 计量（`llm-usage.mjs`：厂商 `stream_options.include_usage` 优先，缺失按 chars/4 估算并标记 `estimated`；可配单价输出估算费用）。

---

## 6. Reasoning / 质量保证（「无直接经验领域有质量保证地编程」）

**主张**：质量保证不能依赖人审查 LLM 输出，要把「正确性判据」前置成机器可验证的产物。

**素材**：
- **两层 SSOT 区分**（原创概念，最佳深聊素材）：
  - 结构契约（§4.3）：谁在场、叫什么、从哪 import → `modules[].exports` / `dependencies[]`，静态 lint 可验证；
  - 行为规格（§4.3.1 `behaviorSpec`）：什么输入返回什么、边界怎么判 → 机读 conditions（稳定 id）+ `when_non_null: all|any` + `edge_rules` + `fixture_hints`。
  - 类比：结构 SSOT = 演员表 + 制服规定；行为规格 = 分镜脚本。只有前者时，多条件 AND 群戏「各演各的」。
- behaviorSpec 消费链：decide 产出（缺 spec 硬拒 + 重试）→ test_write/impl/fix/testfix 注入**同一份** conditions → `BehaviorSpecLint` gate 静态查条件覆盖与 `_set_ideal_*` 顺序。test 和 impl 共享同一机读规格，而不是各自理解散文。
- **跨领域佐证**：引擎是 TypeScript，被开发对象是 Python 量化交易（非本人专业领域）——质量不靠领域直觉，靠 pytest 行为断言 + traceability + strict delivery 双档验收。

**预判追问**：
- *Q: behaviorSpec 谁来保证正确？* → 首期非目标是证明策略 economically 正确；只保证 test 与 impl 共享同一规格，把「俩模型各自理解散文」的二次方差降为一次。spec 本身错误由 decide lint + HITL/Charter 兜底。

---

## 7. Skills / Memory / Subagent / MCP（覆盖较弱，备好话术）

**Skills**（强）：
- 项目论题本身：Matt Pocock Skills（grill → PRD → issues → TDD）在人工 Cursor session 有效，但无机器可读执行清单 → 无法 AFK、无法客观验收。Stagent = 把 Skill 语义内化进引擎。
- 日常也自己写 skill（可举 `~/.agents/skills/` 实例）。

**Memory**（中）：
- 已有：`experiences.jsonl` 失败经验沉淀、decisionRecord 跨 stage 传递、CONTEXT.md/ADR 项目级记忆。
- 诚实说差距：经验沉淀「有写入、未证明改善 Live」（能力矩阵 ❌ 行）——主动暴露这个反而加分，顺势聊 memory 评估难题（EQ-5：仅日志 vs 驱动 prompt/Gate 热修复）。

**Subagent / Multi-Agent**（弱，用架构等价物 + 用户经验补）：
- 架构等价物：每个 stage 是独立上下文的 LLM 调用，decide/test_write/impl/fix 角色分离、靠落盘产物（而非对话历史）通信——这正是 multi-agent 通信的核心问题（共享状态 vs 消息传递），我选了「落盘产物 + SSOT 注入」路线。
- 用户侧：日常深度使用 Cursor 的 subagent（explore/bugbot/并行 Task）。

**MCP**（最弱）：
- 如实说没在引擎里集成；用「执行器抽象（llm-text/code-runner/file-write）天然可换成 MCP tool」+ 日常使用 MCP 的经验带过。不装懂。

---

## 8. 评估与开发者体验（DevEx，JD「对开发者体验有强感知」）

**主张**：Harness 迭代速度取决于「失败 → 定位根因」的成本，我为此专门造了工具。

**素材**（§5.1b，全部 2026-06-11 一天落地）：
- `npm run extract:engine-failure`：读 `.wf-state.json` + `.wf-failures.jsonl` + `.wf-debug.log`，一键结构化输出问题 stage（exitCode / fix 链 / replan / gate 事件），替代人工通读日志；
- `npm run feedback:live:t4:batch`：N=5 跑批 + 成功率汇总，直接执行就绪口径；
- `npm run log:manifest`：从最近 headless 报告初始化 `artifacts/change-manifest.json`（填写 predictedFixes / predictedRegressions）
- `npm run log:draft`：生成 Run # 日志草稿并**自动核对上一轮 manifest 预测**（启发式，须人工确认）；manifest 归档至 `artifacts/manifests/run-<N>-manifest.json`
- RCA 标准路径（§5.3）：快照 → 终态 json → `.wf-state.json` → 「落盘的 test 测的是否为写的 impl」。

**深聊**：这套东西的本质是给 harness 自己做 observability——评估工具的迭代优先级不低于引擎本身。

---

## 9. 弱点预案（被问住之前先想好）

| 可能的质疑 | 应答要点 |
|---|---|
| North Star 没达成（T4 multi-module strict 未稳定绿） | 不回避：当前卡点在 signals 行为语义层，behaviorSpec P0–P2 已落码、离线已验、P3 Live 复验中。强调失败类型已从结构性迁移到语义性 = harness 在收敛。能精确说出「还差什么、为什么难」比「都做完了」更有说服力。 |
| 单人项目，工程协作怎么看 | PR checklist（gate-ssot-pr-checklist.md）、ADR 决策记录、迭代日志即变更审计——按多人规范在跑。 |
| 模型升级后这套 gate 还有必要吗 | gate 成本极低（静态 lint），收益是确定性下界；模型变强改变的是 gate 命中率，不改变「交付需要可验证判据」这件事。可引 Run 数据：强 prompt 下仍有残余命中。 |
| 为什么选量化交易当压测任务 | 多模块依赖 + 多条件布尔语义 + 配置/数据/并发问题齐全，是对 harness 的全谱压力测试；且非本人专业领域，恰好验证「无直接经验领域的质量保证」。 |
| 成本多少 | headless 层已计量 token/费用（`llm-usage.mjs`）；单 run 失败终止 ~365s 量级，理想全量 ≤30min；说得出数字本身就是答案。 |

---

## 10. 面试现场可演示清单（按说服力排序）

1. `docs/t4-live-iteration-log.md` — 翻任意一个 Run 讲「现象 → 根因 → 机制落点」闭环；
2. `packages/stagent-core/src/commitment/behaviorSpecSchema.ts` — 160 行讲清行为规格 SSOT 的机读设计；
3. `quality-gates/postStageGates.ts` + `TestQualityLint.ts` — gate 时序与测试坏味拦截；
4. `InputTokenBudgets.ts` — 14 行讲完 context 预算化；
5. `npm test`（stagent-core，700+ pass）+ mock headless T1 — 5 分钟可跑通的离线演示（不依赖 API key）。

---

## 11. 反问环节备选（体现对 harness 领域的关注）

- 你们的 harness 如何度量「就绪」？有没有类似成功率口径的统计标准？
- 重试时给模型的反馈上下文是怎么设计的？（可自然带出「反馈信息密度」原则交流）
- 评估集是 mock 的还是 Live 的？怎么防止 mock 假绿？
- 模型升级时，prompt/gate 资产如何回归？有没有 golden fixture 机制？
