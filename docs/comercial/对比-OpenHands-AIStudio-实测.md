# 实测对比：AI 编程工具的产物可交付性体检（两案例）

> **被测对象**：① DeepSeek（纯聊天）② OpenHands Agent Canvas ③ Google AI Studio。
> **裁判**：本仓库自研「空心绿」验收方法论（产物须**独立真实运行 + 产出非平凡 + 不可造假 + 行为符合规格**）。
> **日期**：2026-06-17。
> **两个案例**：
> - **案例一（任务一）**：南华期货自动下单软件（模糊 + 不可约领域语义，见 `期货策略-可验收回测规格.md`）。
> - **案例二（任务二）**：工程进度与财务管控系统（清晰、可规约业务 CRUD：进度管控/财务匹配/进度预警/预算预警/月报）。
> **诚实边界**：N=1/案例，非统计基准；结论是**定性**的形态分类。三个工具未严格对齐模型档位（OpenHands 用 DeepSeek，AI Studio 用 Gemini）——故**不比"模型能力"，只比"产物可交付性 + 对待模糊需求的方式"**。

---

## 总结论（跨两案例最重要的发现）

> **决定产物真实性的，主要不是工具，而是"任务的可规约程度（spec-ability）"。**

| | 案例一（期货策略·模糊+不可约） | 案例二（工程财务·清晰可规约） |
|---|---|---|
| AI Studio | ❌ **会演的空心绿**（盈亏=`Math.random()`） | ✅ **真实可交付**（localStorage 持久化 + 真预警/报表） |
| OpenHands | ❌ **沉默的空心绿**（总交易=0、index 死 bug） | ✅ **真实可交付**（SQLite + 真 CRUD + 真聚合） |

**推论（对 Stagent 论点的升华）**：
1. 需求**清晰可机器规约**时，主流工具都能产出真实可用系统——工具差异被抹平。
2. 需求**模糊 + 含不可约领域语义**时，同样的工具齐刷刷退化成空心绿。
3. 所以 **harness 的价值不在"能否生成代码"，而在"模糊/高风险任务下能否挡住空心绿、逼出澄清、绑定可验证判据"**——这正是 Stagent 的 decide 澄清 + 确定性门 + smoke 验收的战场。
4. **「门强 > 模型档」补一句**：任务可规约时差异被抹平；真正拉开差距的是任务进入"模糊+不可约"区间时，**谁有确定性验收与澄清机制**。

---

# 案例一：期货策略（模糊 + 不可约领域语义）

## 0. 一句话结论

> 同一个模糊需求，喂给三个工具，得到**三种不同形态的「空心绿」**：
> - **DeepSeek 聊天**：最诚实——只给设计 + 反问，不产出不可验证的成品（但也没有产物）。
> - **OpenHands**：**沉默的空心绿**——产出能跑的实盘系统，但实时空转、`总交易=0`、含结构性死 bug。
> - **AI Studio**：**会演的空心绿**（最危险）——界面最专业、有盈利曲线，但**回测盈亏 = `Math.random()`**、数据/白点/共振全是随机或写死。
>
> 没有一个能通过「真实运行 + 产出非平凡 + 不可造假」的验收。这正是 Stagent 论点的第三方佐证：**门的强度比模型档位更决定产物质量**；漂亮 UI / 能跑的进程都骗不过确定性验收。

---

## 1. 三方横向对比表

| 维度 | DeepSeek 纯聊天 | OpenHands | AI Studio |
|---|---|---|---|
| 产物形态 | 设计文档 + 反问，无代码 | Python 实盘系统（8 模块） | React+TS 前端监控台（最漂亮） |
| 技术栈 | — | Python / CTP(vnpy/openctp) | React+Vite+TS+recharts |
| 能否运行 | — | 能启动 | 能 `npm run dev` |
| 数据来源 | — | 随机游走 `np.random.normal` | 随机游走 + 上涨偏置 `Math.random()` |
| 是否真回测 | — | ❌ 实时循环（要等≈5h） | ❌ 名义"回测"，**盈亏随机生成** |
| 产出非平凡 | ❌ 无产物 | ❌ `总交易=0` | ⚠️ 有数字，**但是假的** |
| 范围纪律（需求应为回测） | ❌ 漂移实盘 | ❌ 实盘 CTP 报单 | ⚠️ 名义模拟，实为造假 |
| 指标数学 | — | 有（未验证） | ✅ SMA/BOLL/MACD/CCI 公式基本正确 |
| "白点"未定义项 | 静默丢弃 | README 提及，未定义 | ❌ **`Math.random()<0.15` 随机生成** |
| 结构性 bug | — | index deque 永空→信号永不触发 | 回测 CCI 判据偷偷放宽 `>=1` |
| 测试 / oracle | ❌ | ❌ | ❌ |
| 第一印象 vs 真相 | 诚实（只给设计） | 像专业系统，实则空转 | **最唬人，盈利造假** |

---

## 2. 代码级证据（行号可复核）

### 2.1 OpenHands（`/Users/tina/Downloads/futures_trading`）

- **空转 / 总交易=0**：运行日志 `trading_2026-06-17.log` 末行 `交易统计: 总交易=0`。
- **实时循环非回测**：`data_feed.py:90-95` `_simulate_loop` 每 `time.sleep(0.5)` 出一个 tick；K 线按真实时钟 `ts.minute // 3` 合成 → 1 根 3min K 线 = 真实 3 分钟。指标最长 `MAVOL100` 需 100 根 3min K 线 = **300 分钟 ≈ 5 小时**才开始算 → 坐等几乎不可能触发。
- **数据是随机数**：`data_feed.py:100` `change = np.random.normal(0, 1.0) * self.tick_size`。
- **结构性死 bug**：`SimulatedDataFeed._index_3min_klines`（`data_feed.py:76`）**从未被 append**，`get_index_klines()` 永远返回空 DataFrame → 指数共振条件（需求 C7）**永远不成立** → 即使等够 5 小时信号也焊死为 0。
- **范围越界**：`requirements.txt` 引入 `openctp-ctp>=6.7.3`（实盘）；README 提供 `--mode live` + 实盘前置地址 `tcp://180.168.146.187:10130`。需求只需回测。

### 2.2 AI Studio（`/Users/tina/Downloads/南华期货自动下单系统`）

- **回测盈亏是掷骰子**（最致命）：`BacktestSandbox.tsx:82-84`
  ```ts
  const isWin = Math.random() < 0.61;   // 胜负随机，预设61%胜率
  const size = isWin ? 25 : -15;         // 赢+25点 / 输-15点
  simulatedProfit += size * 10;          // 累加成"盈利"
  ```
  截图里"模拟盈溢额 +XXX 点"与盈利账本**与策略在数据上的表现无关**，是随机数。
- **数据随机 + 上涨偏置**：`indicatorMath.ts:187` `currentPrice * volatility * (Math.random() - 0.495)`（注释自承 "gentle upward bias"）。
- **"白点"= 随机数**：`indicatorMath.ts:260` `whiteDot: Math.random() < whiteDotRandomRate`（默认 0.15）。截图状态栏"缺白点形态/带白点趋势确认"即由此驱动（`TradingTerminal.tsx:182`）。
- **"强制触发"= 手动摆拍**：`indicatorMath.ts:271-422` `generateForcedSignalData` 把最后一根 K 线的 MA/MACD/CCI/whiteDot/指数状态**逐字段硬写**成满足条件 → 截图"手动触发行情Tick"点了就出信号。
- **判据被偷偷放宽**：需求要"CCI **二次**穿越(=2)"，但回测 `BacktestSandbox.tsx:73` 与实时审计 `App.tsx:230` 都写 `cciCrossings >= 1`（降成"≥1次"）。
- **CTP "已连接" 是假的**：`App.tsx:55-62` `ctpConfig.isConnected: true`（注释 "Connect by default to give excellent instant preview experience!"）、写死账号/密钥/`14ms 延时`、开机日志 `App.tsx:65-67` 伪造"握手上海托管中心 [1.4ms]"。截图右上"已连接服务器/14ms"全是静态摆拍。
- **行情/指数也是随机漂移**：`App.tsx:135-179` setInterval 每 1.8s `Math.random()` 漂价 + 漂指数；`App.tsx:213` 把"穿插20线"近似成 `|ma20-close|<4` 而非真实穿越判定。

### 2.3 DeepSeek 纯聊天

- 未产出代码；输出为架构图 + 伪代码 + 六条反问（≈ 复述需求歧义）。**静默丢弃"白点"**（多头只说"结构对称"）；**范围漂移到实盘 CTP/vnpy**。详见上一轮记录。

---

## 3. 三种「空心绿」分类（核心洞察）

| 形态 | 代表 | 特征 | 危险度 | 为何危险 |
|---|---|---|---|---|
| **沉默型** | OpenHands | 能跑但空转、产出全 0、死 bug | 中 | 跑一下看到"总交易=0"还能察觉 |
| **会演型** | AI Studio | UI 专业、有盈利曲线，但数字是 `random()` | **高** | **最能骗过验收人**，没有中立验收根本看不出 |
| **诚实留白型** | DeepSeek 聊天 | 只给设计 + 反问，不假装做完 | 低 | 没产物，但不误导 |

> 关键：**产物越漂亮，越可能用随机数伪装"可交付"**。AI Studio 这种"会演的空心绿"正是确定性验收（而非人工肉眼 review）存在的理由。

---

## 4. 对照本仓库验收判据（`期货策略-可验收回测规格.md` §7）

| §7 判据 | DeepSeek | OpenHands | AI Studio |
|---|---|---|---|
| 真实运行 main + 产出非平凡 | ❌ | ❌（总交易=0） | ❌（数字造假） |
| 复现 L1 指标 oracle | ❌ | 未提供 | 公式大致对，但无测试 |
| 复现 L2 谓词 oracle（二次穿越/倍量/横盘/共振） | ❌ | 死 bug | CCI 判据放宽、共振写死 |
| 不得整体 mock/造数据 | — | 随机数据 | **随机盈亏 + 随机白点** |
| 构造"全命中样本"必出信号 | ❌ | index 死 bug 永不出 | 只有"手动摆拍"才出 |

**三方在 §7 下全不通过。**

---

## 5. 与 Stagent 设计目标的对照

Stagent 的几道门正是冲着上面三类问题设计的：

- **smoke 阶段断言"产出非平凡"**（ADR-0008）→ 会拦住 OpenHands 的 `总交易=0` 与 AI Studio 的空账本。
- **TestQualityLint `collaborator-mock-only` / 禁占位**（ADR-0008）→ 对应"用随机数/写死值伪装结果"这类假绿。
- **blockDeliveryOnTestFailure**（测试未过拦交付）→ 不让"能跑但没验证"通过交付。
- **decide 阶段产机读契约 + 标澄清项**（本仓库手工版见 `期货策略-可验收回测规格.md` §1/§9）→ 对应"白点未定义"应被**显式澄清**而非随机糊弄/静默丢弃。

> 注意：这是**设计目标对照**，不是说 Stagent 已在本期货任务上跑出合格产物（该任务领域语义重、属 Stagent 自评的模型能力卡点）。本文证明的是**验收方法论**的价值，而非 Stagent 引擎在本任务上的产出优势。

---

## 6. 环境/工程摩擦记录（也是产物质量的一部分）

| 工具 | 摩擦 |
|---|---|
| OpenHands 安装 | 缺 `uv`（`uvx` 启动 agent server）；首启下载 Python 3.12，`server_info` 60s 超时；前端 React `removeChild` 崩溃；DeepSeek `Insufficient Balance` |
| OpenHands 产物 | README 写裸 `pip`（本机只有 `pip3`）；引入 Mac 难装/本任务不需要的 `openctp-ctp` |
| AI Studio 产物 | 需 `GEMINI_API_KEY`；README 为 AI Studio 模板（非项目说明） |

---

## 7. 面试可用的一句话

> "我用自研的『空心绿』验收方法论，体检了三个主流工具（DeepSeek / OpenHands / AI Studio）对同一个模糊真实需求的产物，发现三种不同形态的空心绿——尤其 AI Studio 的回测盈亏是 `Math.random()` 编的。这印证了我的核心论点：**没有确定性验收，能跑/好看都不等于可交付**，而这正是 harness 该补的位。"

---

## 附：证据文件索引

- OpenHands 产物：`/Users/tina/Downloads/futures_trading/`（`data_feed.py`、`trading_2026-06-17.log`、`requirements.txt`）
- AI Studio 产物：`/Users/tina/Downloads/南华期货自动下单系统/`（`src/utils/indicatorMath.ts`、`src/components/BacktestSandbox.tsx`、`src/App.tsx`、`src/components/TradingTerminal.tsx`）
- 验收判据：`docs/comercial/期货策略-可验收回测规格.md`
- 前端截图：`.cursor/.../assets/image-68408455-...png`（标注 CTP "已连接/14ms"、"缺白点形态" 等，均为静态/随机摆拍）

---

# 案例二：工程进度与财务管控系统（清晰、可规约业务 CRUD）

> **需求**：电脑端小软件，含工程进度管控、财务数据匹配、进度预警、财务预算预警、月度报表。
> **结论先行**：**两个工具这次都产出了真实可交付的系统**——与案例一形成强烈反差，恰恰证明了"spec-ability 决定产物质量"。

## 1. 两方对比表

| 维度 | AI Studio | OpenHands |
|---|---|---|
| 架构 | React+TS 前端，**localStorage 持久化** | **Flask + SQLite 后端** + 原生 JS 前端 |
| 数据持久化 | ✅ localStorage（浏览器内，单机） | ✅ SQLite 文件 `data.db`（更接近"软件"） |
| CRUD | ✅ 真状态变更 + 级联删除（删项目→清里程碑/凭证匹配） | ✅ `fetch` 真接 Flask REST（`app.js` get/post/put/del） |
| 进度计算 | 里程碑 `progressPercent`（**手填**）+ 逾期判定 | 里程碑**权重加权自动算** `(done+inprog*0.5)/total`（更符合"管控"语义） |
| 财务匹配 | ✅ 凭证↔项目/里程碑 真匹配，未匹配主动预警 + 一键跳转 | ✅ 财务记录写入即按类别/月**真聚合**回填预算实际值 |
| 进度预警 | ✅ 逾期天数分级（>15天 critical），真比率 | ✅ 时间应完成比例 vs 实际进度，滞后>20% danger |
| 预算预警 | ✅ 里程碑级+项目级双层 `支出/预算`（>1 critical、>0.85 warning） | ✅ 执行率 ≥100% 超支 / ≥80% 预警 |
| 月度报表 | ✅ 真算（收支/净流/分类拆解/YTD 趋势 SVG，全 `reduce` 聚合） | ✅ 真 SQL 聚合（收支/各项目费用/预算执行/预警数） |
| 真实可交付 | ✅ 是 | ✅ 是 |

## 2. 真实瑕疵（均为质量问题，非"空心绿"）

**AI Studio**（`src/App.tsx` / `src/components/ReportsView.tsx`）：
- 进度靠**手填 `progressPercent`**，非里程碑权重推导（弱于 OpenHands）。
- "当前日期"写死 `2026-06-17`（`App.tsx:64`）——预警的"逾期"判定依赖它，长期使用会失真。
- "导出本月报表"是 `alert()` **假按钮**（`ReportsView.tsx:136 handleExportDummy`）——占位未实现。
- MONTHS 数组笔误 `value:'2526-04'`（`ReportsView.tsx:36`），4 月选项 value 错误。

**OpenHands**（`models.py` / `static/js/app.js`）：
- `check_and_generate_alerts`（`models.py:376`）**无去重**——每次刷新重复插入同样预警，会堆积。
- `_sync_budget_actual` 只更新已存在预算、不创建（设计上靠 `create_budget` 补算，耦合隐蔽）。
- `loadProjects`（`app.js:121`）先渲染再逐项目 `await` 进度 = **N+1 请求 + 二次渲染**，项目多了会慢/闪。

## 3. 细微高下（都合格前提下）

- **进度语义**：OpenHands 更强（权重自动推导 vs AI Studio 手填）。
- **财务匹配交互**：AI Studio 更完整（未匹配凭证主动预警 + 一键跳转匹配）。
- **"软件感"**：OpenHands 是真后端 + DB 文件 + 一键启动器（`启动系统.command`），更接近"电脑上使用的软件"；AI Studio 是浏览器单机应用（换设备/清缓存丢数据）。
- **导出**：OpenHands 用 `window.print()` 真打印；AI Studio 导出是假按钮。

## 4. 案例二与 Stagent 论点

案例二里两个工具都"真实可交付"，说明**清晰任务下 harness 的边际价值低**——这是诚实的反向证据。Stagent 的差异化价值集中在**案例一那种模糊/高风险任务**：decide 澄清逼出"白点/点位"未定义项、确定性门拦占位（如 AI Studio 的假导出按钮、OpenHands 的预警堆积）、smoke 验收拦空转。**好 harness 在简单任务上不显眼，在难任务上才是护城河。**

## 5. 案例二证据文件索引

- AI Studio：`/Users/tina/Downloads/工程进度与财务管控系统/`（`src/App.tsx`、`src/utils/warningCalculator.ts`、`src/components/ReportsView.tsx`、`src/data/mockData.ts`）
- OpenHands：`/Users/tina/Downloads/project_manager/`（`app.py`、`models.py`、`static/js/app.js`、`启动系统.command`）
