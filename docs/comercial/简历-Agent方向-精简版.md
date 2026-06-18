# 何淑婷

上海 · 18718143986 · 571328641@qq.com · [GitHub](https://github.com/he18718143986-design)

> 求职意向：**Agent Harness / AI Agent 产品研发工程师**

---

## 个人概述

自动驾驶测试工程师出身，近两年全职投入 AI 辅助软件开发，以独立开发者身份交付 **9 个跨领域软件项目（均已开源）**。在交付实践中沉淀出对 LLM 行为方差、上下文工程与质量保证的系统认知，并工程化为自研项目 **Stagent——一个 AFK（无人值守）软件开发引擎 / Agent Harness**。

- **Agent 重度用户**：深度使用 Cursor，Skills / Subagent / MCP / Hooks 融入日常工作流，自写自维护 Agent Skills。
- **跨领域质量保证**：在无直接经验的语言/领域（TypeScript 引擎、Python 量化）中，靠机器可验证判据（测试、契约、Gate）而非领域直觉保证质量。
- **测试工程纪律**：把「可复现、可度量、可回归」的验证纪律带入 Agent 系统开发。

---

## 核心项目

### Stagent — AFK 软件开发引擎（Agent Harness） · 独立设计与开发

**2025 至今 · TypeScript / Python · [GitHub](https://github.com/he18718143986-design/Stagent) · 核心引擎 700+ 单测**

把人工 Agent 工作流（需求澄清 → PRD → 任务拆分 → TDD）内化进引擎：将需求编译为机器可读 stage DAG，按切片自动执行 RED→GREEN 测试驱动链，用「确定性 Gate + 契约/行为 SSOT 注入 + 有界重试/replan」约束 LLM 方差，实现无人值守、可客观验收的软件交付。

- **两段式 Planning**：LLM 生成计划 + 确定性 Plan Compiler 编译（artifact 图 lint、计划完整性硬门禁），「骨架定结构、LLM 填语义」收敛多 stage DAG 方差。
- **两层 SSOT 设计（原创）**：区分结构契约（exports/imports，静态可 lint）与行为规格（机读 `behaviorSpec`），让测试与实现共享同一份机读规格，根治两次 LLM 调用各自理解散文导致的语义漂移。
- **质量门禁 + 有界重试**：确定性 Gate（pytest、契约 lint、测试质量 lint——拦弱断言与 `sys.modules` 劫持）exit 0 才前进；失败有界重试（fix 链上限 → 确定性 replan），杜绝死循环。
- **Context Engineering 预算化**：上下文总额/分配比例/截断阈值均为代码常量；超预算走引用式注入；stable prefix + 变动后缀（KV cache 友好）；headless 全链路 token/费用计量。
- **评估驱动迭代**：三层回归金字塔（单测 → mock headless → Live LLM），以成功率口径（N=5 连跑 strict ≥3）定义就绪；50+ 次 Live 迭代日志，失败模式归因到「结构性 vs 行为性」并落为对应机制。
- **「空心绿」治理（判断力素材）**：实测发现 strict 门全绿 ≠ 可交付（mock 假绿 / fixture 污染 / main 空转），将验收口径从「门绿」升级为「真实运行非平凡」，把真实集成冒烟做成工作流内可自愈阶段；沉淀核心洞见——**门的强度比模型档位更决定产物质量**；并把长尾修复判据从「聚合成功率」改为「失败模式复发率」（对 LLM 方差的统计自觉）。
- **多会话编排（Multi-Agent 实战）**：以「指挥会话（决策/规格/评审）＋ 独立 Cloud Agent 会话 ＋ worktree 隔离子代理」协作推进治理，经 SSOT 看板 + PR diff 异步同步、`git merge-tree` 合并冲突预检防互踩；含一个诚实的负面结果——best-of-N 采样择优因「评分信号未对齐失败模式」无收益且 ~3× 成本，据数据默认关闭。

### AI 辅助软件交付 · 独立开发者

**2024.07 – 至今 · 9 个客户项目（均已开源） · [GitHub 作品集](https://github.com/he18718143986-design)**

以 AI Agent 为核心生产方式交付跨领域软件（点云 / 仿真 / 卫星通信 / 量化 / IoT 管控 / 多模态视频等），全部开源：

- **[factory-visitor-lan-control](https://github.com/he18718143986-design/factory-visitor-lan-control)**：厂区访客设备本地管控（Node.js + Android + mDNS/ADB 局域网配对 + 多 ROM 权限自动化）
- **[ai-video-style-studio](https://github.com/he18718143986-design/ai-video-style-studio)**：Gemini 多模态视频「风格 DNA」提取 + 五阶段生产流水线（脚本/分镜/生成/浏览器合成）
- **[powerline-lidar-extraction](https://github.com/he18718143986-design/powerline-lidar-extraction)**：电力线 LiDAR 点云 PMF→TIN→RANSAC 全自动链 + Potree 三维可视化
- 另有：厂界噪声仿真（[esm-noise-simulator](https://github.com/he18718143986-design/esm-noise-simulator)）、外骨骼步态仿真（[exoskeleton-gait-simulator](https://github.com/he18718143986-design/exoskeleton-gait-simulator)）、Hull 量化仪表盘（[hull-market-prediction](https://github.com/he18718143986-design/hull-market-prediction)）、知识融合框架（[knowledge-amalgamation-framework](https://github.com/he18718143986-design/knowledge-amalgamation-framework)）、LEO-GEO 功率控制（[leo-geo-power-control](https://github.com/he18718143986-design/leo-geo-power-control)）、频谱感知 PINN（[spectrum-informed-pinn-helmholtz](https://github.com/he18718143986-design/spectrum-informed-pinn-helmholtz)）
- **方法论沉淀**：建立「需求澄清 → PRD → TDD → 验收」AI 协作工作流，识别其无法 AFK 的瓶颈——直接催生 Stagent。

---

## 工作经历

### 深圳市未来智能网联交通系统产业创新中心 · 自动驾驶工程师 · 2022.04 – 2024.07

- 对标国内外法规制定自动驾驶测试规程与验证方案，参与编制坪山区自动驾驶政策法规及市级地方/团体标准，审核企业申请材料并组织专家评审。
- **成果**：完成欧美日及国内政策汇编；签订近百万元团体标准合同；审核 20 个自动驾驶系统测试申请；服务多家企业完成功能测试。
- **可迁移**：监管级安全验证思维（可复现、有判据）→ Stagent 的确定性 Gate 与 strict 验收口径；测试场景设计 → 场景化回归与 RCA。

### 广东省城乡规划设计研究院有限责任公司 · 智慧交通工程师 · 2018.09 – 2022.03

- 主导智慧交通平台产品策划（Axure / Xmind 完成需求分析、架构、数据结构、原型）；产出车路协同交叉口解决方案；用 VisSIM / Sumo 构建数字孪生仿真方案。
- **成果**：完成智慧公路管养系统、延崇车路协同系统、智能交叉口等方案并通过验收；完成省工程院科研课题；多个设计项目通过验收或获竞赛一等奖。
- **可迁移**：需求澄清 → 原型 → 架构 → 验收全流程 → Stagent 的需求澄清/PRD 链路与「机器可验收」设计；仿真验证经验 → mock→Live 多档回归方法论。

---

## 技能

- **Agent / LLM**：Agent Harness 设计（AgentLoop / Tool Use / Planning / Gate / 重试结构）、Prompt & Context Engineering（SSOT 注入、token 预算、KV cache 友好拼装）、LLM API（流式 / usage 计量 / JSON mode）、Skills / Subagent / MCP / Memory、失败模式分析与评估体系（golden fixture、成功率口径、Live 回归）
- **工程**：TypeScript / Node.js、Python（pytest / 量化）、VS Code 扩展、CI 与 headless 自动化、沙箱与进程隔离
- **工具**：Cursor（Skills / Subagent / Hooks / 自动化）、Git

## 教育背景

- 华南理工大学 · 交通工程 · 本科 · 2013.09 – 2017.06

---

*Stagent：[github.com/he18718143986-design/Stagent](https://github.com/he18718143986-design/Stagent) · 全部项目：[github.com/he18718143986-design](https://github.com/he18718143986-design)*
