# 【何淑婷】

【上海】 · 【18718143986】 · 【571328641@qq.com】 · 【GitHub / 个人主页链接】

> 求职意向：**Agent Harness / AI Agent 产品研发工程师**

---

## 个人概述

两年前从自动驾驶行业辞职，全职投入 AI 辅助软件开发：以独立开发者身份为客户交付 **10 个跨领域软件项目**，全程以 AI Agent 工具为核心生产方式。在交付实践中沉淀出对 LLM 行为方差、上下文工程与质量保证机制的系统认知，并将其工程化为自研项目 **Stagent——一个 AFK（无人值守）软件开发引擎 / Agent Harness**。

- **Agent 重度用户**：Cursor / 代码类与通用类 Agent 产品深度使用者，Skills、Subagent、MCP、Hooks 融入日常工作流；自己编写和维护 Agent Skills。
- **跨领域质量保证**：在不具备直接经验的语言/框架/领域（如 TypeScript 引擎开发、Python 量化交易）中，依靠机器可验证的判据（测试、契约、Gate）而非领域直觉保证交付质量。
- **测试工程背景**：自动驾驶测试出身，把「可复现、可度量、可回归」的验证纪律带入了 Agent 系统开发。

---

## 核心项目

### Stagent — AFK 软件开发引擎（Agent Harness） · 独立设计与开发

**2025 至今 · TypeScript（引擎）/ Python（压测对象） · 自研项目**

**一句话简介**：把人工 Agent 工作流（需求澄清 → PRD → 任务拆分 → TDD）的语义内化进引擎，将需求编译为机器可读的 stage DAG，按切片自动执行 RED→GREEN 测试驱动开发链，通过「确定性 Gate + 契约/行为 SSOT 注入 + 有界重试/replan」约束 LLM 方差，实现无人值守、可客观验收的软件交付。

**架构**：体验层（headless CLI / VS Code 扩展）→ 编排层（Path Router / Plan Compiler / Phase Gate）→ 执行层（llm-text / code-runner / file-write / runtime-replan）→ 持久层（实例状态 / 决策记录 / 经验沉淀）。核心引擎 700+ 单元测试。

**亮点**：

- **两段式 Planning**：LLM 生成计划 + 确定性 Plan Compiler 编译（artifact 图 lint、计划完整性硬门禁、基础设施 stage 清洗），用「骨架模板定结构、LLM 填语义」将多 stage DAG 的生成方差工程化收敛。
- **双轨质量门禁**：A 轨为确定性 Gate（pytest、import 验证、模块契约 lint、测试质量 lint——拦截弱断言与 `sys.modules` 劫持等 LLM 测试反模式），exit 0 才前进；B 轨为可审计的 HITL/代答决策。失败有界重试（fix 链上限 → 确定性 replan），杜绝无限循环。
- **两层 SSOT 设计（原创）**：区分**结构契约**（exports / imports / 依赖，静态可 lint）与**行为规格**（机读 `behaviorSpec`：条件 id + AND/OR 链 + 边界规则），让测试与实现共享同一份机读规格，根治「两次 LLM 调用各自理解需求散文」导致的语义漂移。
- **Context Engineering 预算化**：上下文总额、各类信息分配比例、截断阈值均为代码常量（总额 60k、决策记录 0.35 / 全局决策 0.25 等）；超预算走引用式注入；prompt 采用稳定前缀 + 变动后缀的拼装结构（KV cache 友好）；headless 全链路 token/费用计量。
- **评估驱动的迭代方法论**：三层回归金字塔（单测 → mock headless → Live LLM），以成功率口径（N=5 连跑 strict pass ≥3）而非「单次跑通」定义就绪；50+ 次 Live 迭代日志，每个失败模式归因到「结构性 vs 行为性」并落为对应 Gate/Prompt 机制；自研失败快照、批量跑批、日志草稿等 harness observability 工具链。
- **沙箱与运行边界**：代码执行沙箱（内存/超时限制、网络默认阻断并审计、写路径白名单）、不可安装依赖 denylist、确定性 smoke 命令推断与数据种子。
- **压测验证**：以 Python 量化交易系统（5 模块：指标/信号/风控/撮合/系统集成）为持续压测任务，驱动失败类型从结构性错误（import/export 漂移）收敛至行为语义对齐层。

### AI 辅助软件交付 · 独立开发者

**2024.X – 至今 · 累计交付 10 个客户项目**

从零转型，以 AI Agent 工具为核心生产方式承接并交付跨领域软件项目，覆盖【举例：Web 应用 / 桌面工具 / 数据处理 / 自动化脚本——请替换为真实项目类型】等方向。

- 【项目 1 占位：一句话描述 + 技术栈 + 交付成果/客户价值，建议挑规模最大或最能体现跨领域的 2–3 个展开】
- 【项目 2 占位】
- 【项目 3 占位】
- **方法论沉淀**：在多项目交付中建立「需求澄清 → PRD → 任务拆分 → TDD → 验收」的 AI 协作工作流（基于 Agent Skills 体系），并识别出其无法 AFK、无法客观验收、多 session 上下文断裂的瓶颈——这成为 Stagent 的直接动机。
- **跨领域学习能力**：每个项目平均涉及【N】个此前无直接经验的技术栈，依靠 AI 辅助 + 测试先行保证交付质量，【可补充：客户复购/好评等量化证据】。

---

## 工作经历

### 【公司名】 · 自动驾驶测试工程师

**【20XX.X – 2024.X】**

- 【占位：负责的测试方向，如感知/规控/仿真/实车测试；测试体系或工具链建设的量化成果】
- 可迁移资产：场景化测试设计、可复现性纪律、失败归因（RCA）方法——直接复用于 Stagent 的 Live 迭代与 Gate 体系设计。

### 【公司名】 · 智能交通解决方案工程师

**【20XX.X – 20XX.X】**

- 【占位：负责的解决方案方向、典型项目、规模】
- 可迁移资产：多方需求澄清与方案文档能力——复用于 Stagent 的需求澄清 / Charter / PRD 生成链路设计。

---

## 技能

- **Agent / LLM**：Agent Harness 设计（AgentLoop / Tool Use / Planning / Gate / 重试结构）、Prompt & Context Engineering（SSOT 注入、token 预算、KV cache 友好拼装）、LLM API（流式、usage 计量、JSON mode）、Skills / Subagent / MCP / Memory 机制、模型失败模式分析与评估体系（golden fixture、成功率口径、Live 回归）
- **工程**：TypeScript / Node.js（引擎开发）、Python（pytest / 量化）、VS Code 扩展、CI 与 headless 自动化、沙箱与进程隔离
- **工具**：Cursor（深度用户：Skills / Subagent / Hooks / 自动化）、Git、【其他】

## 教育背景

- 【学校 · 专业 · 学位 · 年份】

---

*Stagent 详细技术文档与 50+ 次迭代日志可供查阅：【仓库链接】*
