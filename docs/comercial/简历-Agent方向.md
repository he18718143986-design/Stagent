# 何淑婷

上海 · 18718143986 · 571328641@qq.com · [GitHub](https://github.com/he18718143986-design)

> 求职意向：**Agent Harness / AI Agent 产品研发工程师**

---

## 个人概述

两年前从自动驾驶行业辞职，全职投入 AI 辅助软件开发：以独立开发者身份为客户交付 **9 个跨领域软件项目（均已开源）**，全程以 AI Agent 工具为核心生产方式。在交付实践中沉淀出对 LLM 行为方差、上下文工程与质量保证机制的系统认知，并将其工程化为自研项目 **Stagent——一个 AFK（无人值守）软件开发引擎 / Agent Harness**。

- **Agent 重度用户**：Cursor / 代码类与通用类 Agent 产品深度使用者，Skills、Subagent、MCP、Hooks 融入日常工作流；自己编写和维护 Agent Skills。
- **跨领域质量保证**：在不具备直接经验的语言/框架/领域（如 TypeScript 引擎开发、Python 量化交易）中，依靠机器可验证的判据（测试、契约、Gate）而非领域直觉保证交付质量。
- **测试工程背景**：自动驾驶测试出身，把「可复现、可度量、可回归」的验证纪律带入了 Agent 系统开发。

---

## 核心项目

### Stagent — AFK 软件开发引擎（Agent Harness） · 独立设计与开发

**2025 至今 · TypeScript（引擎）/ Python（压测对象） · [GitHub](https://github.com/he18718143986-design/Stagent) · 自研项目**

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

**2024.07 – 至今 · 累计交付 9 个客户项目（均已开源） · [GitHub 作品集](https://github.com/he18718143986-design)**

以 AI Agent 工具为核心生产方式承接并交付跨领域软件项目，覆盖点云算法、物理仿真、卫星通信、量化交易、厂区 IoT 管控、多模态视频生产等方向（自研 Stagent 见上文核心项目）。

#### 重点代表项目

- **[factory-visitor-lan-control](https://github.com/he18718143986-design/factory-visitor-lan-control)**（Node.js + Android · 厂区本地部署）  
  门卫电脑端控制台 + 访客 Android App，基于 mDNS 局域网发现与 ADB 无线配对，实现进厂扫码、摄像头/截屏权限管控与多 ROM 自动化适配；裁剪云端 SaaS 模块后按单厂局域网交付。

- **[ai-video-style-studio](https://github.com/he18718143986-design/ai-video-style-studio)**（React + TypeScript + Gemini API）  
  上传参考视频提取「风格 DNA」，经调研 → 脚本 → 分镜 → 图像/视频生成 → TTS → 浏览器 Canvas 合成五阶段流水线，人机协同门控 + Style Profile 可导入复用。

- **[powerline-lidar-extraction](https://github.com/he18718143986-design/powerline-lidar-extraction)**（Python · 点云算法）  
  PMF 地面滤波 → TIN 渐进密化 → RANSAC 多线拟合全自动处理链，支持分块并行与 Potree Web 三维可视化，面向电力线 LiDAR 批量生产场景。

#### 更多开源交付

| 项目 | 技术栈 | 一句话价值 |
|------|--------|-----------|
| [esm-noise-simulator](https://github.com/he18718143986-design/esm-noise-simulator) | Python / PyQt6 | ISO 9613-2 厂界噪声传播仿真 GUI，参数化建模与结果可视化 |
| [exoskeleton-gait-simulator](https://github.com/he18718143986-design/exoskeleton-gait-simulator) | Python | 外骨骼步态规划仿真 + TCP 设备通信联调 |
| [hull-market-prediction](https://github.com/he18718143986-design/hull-market-prediction) | Python / PySide6 | Kaggle Hull Tactical 多模型预测仪表盘与策略对比 |
| [knowledge-amalgamation-framework](https://github.com/he18718143986-design/knowledge-amalgamation-framework) | TensorFlow | 三教师 DFA 知识融合与模型蒸馏实验框架 |
| [leo-geo-power-control](https://github.com/he18718143986-design/leo-geo-power-control) | Python | NSGA-II 多目标优化的 LEO-GEO 卫星功率控制仿真 |
| [spectrum-informed-pinn-helmholtz](https://github.com/he18718143986-design/spectrum-informed-pinn-helmholtz) | JAX / PyTorch | 频谱感知三阶段 PINN 求解亥姆霍兹方程，含 PyTorch 基线对照 |

- **方法论沉淀**：在多项目交付中建立「需求澄清 → PRD → 任务拆分 → TDD → 验收」的 AI 协作工作流（基于 Agent Skills 体系），并识别出其无法 AFK、无法客观验收、多 session 上下文断裂的瓶颈——这成为 Stagent 的直接动机。
- **跨领域学习能力**：每个项目平均涉及 2–4 个此前无直接经验的技术栈，依靠 AI 辅助 + 测试先行保证交付质量。

---

## 工作经历

### 深圳市未来智能网联交通系统产业创新中心 · 自动驾驶工程师

**2022.04 – 2024.07**

> 制定自动驾驶测试规程与政策标准，推动自动驾驶系统的安全验证落地。

- **测试规程与验证方案**：分析企业测试需求，对标国内外法规标准制定自动驾驶测试规程与技术验证方案，并在测试场内搭建测试场景。
- **政策标准编制**：调研国内外智能网联汽车监管与技术路线，参与编制深圳市坪山区自动驾驶政策法规，主导制定并发布市级地方及团体标准。
- **技术审核与评审**：参与坪山区智能网联汽车全域开放第三方管理，撰写法规配套实施细则，审核企业申请材料并组织专家评审会。
- **量化成果**：完成欧美日及国内自动驾驶政策汇编；签订近百万元团体标准合同；审核 20 个自动驾驶系统的测试申请；服务多家自动驾驶企业完成功能测试。
- **可迁移资产**：把「安全验证 = 可复现、可度量、有明确判据的规程」这套监管级验证思维，工程化为 Stagent 的确定性 Gate 与 strict 验收口径；测试场景搭建经验直接对应场景化回归测试设计与失败归因（RCA）方法。

### 广东省城乡规划设计研究院有限责任公司 · 智慧交通工程师

**2018.09 – 2022.03**

> 覆盖工程咨询、智慧交通产品设计、车路协同方案与道路规划的全流程工作。

- **智慧交通产品策划与设计**：调研政府业主需求，主导智慧交通平台产品策划，使用 Axure / Xmind 完成需求分析、系统架构、数据结构、产品原型与宣传手册。
- **车路协同解决方案**：产出车路协同城市交叉口应用场景解决方案，参与高速项目工程设计与设备安装调试；用 VisSIM / Sumo 构建数字孪生（车路协同仿真）方案，并对公司开展相关知识培训。
- **规划设计与工程咨询**：掌握 GIS / CAD，参与城市路网研究规划、轨道及道路选址审批，完成市政工程设计方案与多份标书、咨询报告；申请交通预测模型专利。
- **量化成果**：参与广州市增城区路网规划及多条道路设计、交叉口治理；独立或参与完成智慧公路管养系统、延崇车路协同系统、智能交叉口方案等并通过验收；完成广东省工程院科研课题、智慧交通决策一体化平台等研究项目；多个设计项目通过验收或获竞赛一等奖（含产业园区概念设计、物流港规划等）。
- **可迁移资产**：从多方需求澄清 → 产品原型 → 系统架构 → 验收的全流程经验，复用于 Stagent 的需求澄清 / Charter / PRD 生成链路与「机器可验收」设计；仿真 / 数字孪生的建模与验证经验，对应以 mock → Live 多档回归压测 harness 的评估方法论。

---

## 技能

- **Agent / LLM**：Agent Harness 设计（AgentLoop / Tool Use / Planning / Gate / 重试结构）、Prompt & Context Engineering（SSOT 注入、token 预算、KV cache 友好拼装）、LLM API（流式、usage 计量、JSON mode）、Skills / Subagent / MCP / Memory 机制、模型失败模式分析与评估体系（golden fixture、成功率口径、Live 回归）
- **工程**：TypeScript / Node.js（引擎开发）、Python（pytest / 量化）、VS Code 扩展、CI 与 headless 自动化、沙箱与进程隔离
- **工具**：Cursor（深度用户：Skills / Subagent / Hooks / 自动化）、Git

## 教育背景

- 华南理工大学 · 交通工程 · 本科 · 2013.09 – 2017.06

---

*Stagent 详细技术文档与 50+ 次迭代日志：[github.com/he18718143986-design/Stagent](https://github.com/he18718143986-design/Stagent) · 全部开源项目：[github.com/he18718143986-design](https://github.com/he18718143986-design)*
