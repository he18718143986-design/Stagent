# autoAI 项目规格文档

> **本文档是项目的唯一真理来源。**
> 每次修改功能前先修改本文档，再改代码。如果代码与本文档不符，以本文档为准。

---

## 一、项目定义

**一句话**：一个 Mac 桌面应用，通过后台自动操控任意 AI 网页（无需 API Key），统一管理文字、图片、视频等 AI 工作流。

**核心引擎只做一件事**：
```
向任意网页注入输入 → 等待完成 → 提取输出
                              ↓
               输出类型由网站决定：
               - 文字（ChatGPT / Claude / Gemini）
               - 图片 URL（Midjourney / Ideogram）
               - 视频文件（Sora / Runway）← 预留扩展
```

**核心价值主张**：
- 用户用自己的账号登录 AI 网站（免费套餐可用）
- 登录一次，永久有效（关闭软件不丢登录状态）
- 目标是支持任意 AI 网页；V1 重点验证文字站点，图片站点以 URL 提取为准，视频站点仅保留接口
- 没有 API Key；autoAI 自身不引入平台月费或统一额度
- 第三方 AI 网站自身的会员、额度、风控与封禁策略仍然存在，autoAI 不承诺绕过

**不是什么**：
- 不是 API 聚合器
- 不是浏览器插件
- 不是爬虫工具
- 不是自动回复机器人
- 不是规避第三方网站付费、额度或风控机制的工具

### 1.1 术语与当前基线

- `siteId`：单个 AI 账号记录的唯一键（UUID）。Session、WebContentsView、IPC、消息隔离都以 `siteId` 为准。
- `hostname`：域名（如 `chatgpt.com`），用于 preset 查找与界面展示，可重复，不作为账号唯一键。
- `SiteConfig`：单个账号的持久化配置记录；同一 `hostname` 可对应多个 `SiteConfig`。
- `SelectorChain`：同一目标元素的多策略降级链，按 `priority` 从高到低执行。
- 除里程碑中明确标注为“计划 / 未实现”的能力外，本文默认描述当前基线；若当前 UI 与未来里程碑冲突，以带有“当前 / 计划 / TBD”标记的表述为准。

---

### 1.2 体验成功定义与验收策略

> **本节是 SPEC 中唯一对「主观体验」作出明确界定的章节。**
> 不替代 §六（核心数据流）和 §十（里程碑）的功能规格，而是在其基础上补充可操作的体验验收视角。

#### 1.2.1 体验成功定义

autoAI 的体验成功定义是：**维护者将应用作为日常主要 AI 入口，使用数周后仍愿意继续使用**。可观测的具体指标为：

- 向已连接 AI 发消息的成功率稳定（无需频繁手动干预），等待时间感受与直接在浏览器中使用同一 AI 相当；
- 每次启动直接进入 ChatPage，已登录站点无需重新验证（session 持久化）；
- 失败（选择器失效、额度耗尽、登录超时）时，界面给出**清晰可操作**的提示，用户在不超过 3 步内能自助恢复；
- 应用**从不误导**关于第三方 AI 的费用或额度（不伪报额度已清、不隐藏 quota-exhausted 状态）；
- Tab Bar 的增删与状态同步即时可见，无“幽灵标签”（Tab 存在但实际无法发送消息）。

> **最终判定**：仅有维护者本人的**狗食测试（dogfooding）**能最终确认“感受良好”；本节清单与自动化策略用于回归保护和 AI 协作对齐，**不声称**已完全替代主观体验验收。

---

#### 1.2.2 可操作的体验验收清单

编号 TA-XX 供后续交叉引用。`[E2E]` = 适合回归自动化；`[手工]` = 须保留为狗食测试；`TBD` = 当前版本未实现。

| ID | 场景（Given → When） | 期望结果（Then） | 类型 |
|---|---|---|---|
| **TA-01** | 无任何站点记录 → 首次启动 | 显示向导页（5 个预设卡片 + “其他”入口），无聊天界面 | [E2E] |
| **TA-02** | 向导页或资源管理页 → 点击预设卡片（如 Claude） | Claude 登录页展开（WebContentsView 覆盖内容区），状态显示“登录中…” | [E2E] |
| **TA-03** | 已在登录页完成账号登录 → 聊天输入框在后台变为可见 | 500ms 首检或 1.5s 轮询命中 → 登录页自动收起，跳转 ChatPage，Tab Bar 出现该站点标签，status=connected | [手工]* |
| **TA-04** | status=connected 站点，ChatPage 正常态 → 输入非空文本并发送 | ① 立即追加本地用户消息；② 输入框 disabled；③ 120s 内收到 AI 回复（正文须非空且不得仅为作者标签，见 §2.0.4）；④ 输入框重新 enabled | [E2E] |
| **TA-05** | 已连接至少一个站点 → 关闭并重新打开应用 | 直接进入 ChatPage，probeAllSites（5s 后）推送 status=connected，无需重新登录 | [E2E] |
| **TA-06** | 发消息期间 quotaExhaustedIndicator 出现 → 额度用尽触发 | ① 追加通知（有其他可用：“今日额度已用尽，请从上方标签栏切换其他账号继续对话”；全部耗尽：“所有账号额度已用尽，请明天再试或在设置中添加新账号”）；② 当前账号输入框 disabled；③ 不自动切换 activeSiteId；④ quotaExhausted=true 持久化 | [E2E] |
| **TA-07** | 所有选择器失效 → 用户发送消息，注入失败 | 3s 内显示两步校准引导（CalibrationOverlay），完成后恢复正常发消息 | [手工] |
| **TA-08** | 用户持有新 CSS 选择器 → 在 SelectorDebugger 粘贴并保存 | 立即生效，下次发消息使用新选择器；calibrated=true 写入；无需重启 | [手工] |
| **TA-09** | Tab Bar 显示 ChatGPT 和 Claude → 点击 Claude 标签 | 消息列表切换至 Claude 历史，placeholder 变“给 Claude 发消息…”，ChatGPT 消息不可见 | [E2E] |
| **TA-10** | Tab Bar 中某标签 × 按鈕 → 点击 × | 账号从 site-store 删除，Tab 消失，session 清除；若被删者是 activeSiteId，自动切换至首个剩余连接标签（或空态） | [E2E] |
| **TA-11** | 所有账号 disconnected 或全被删 → 处于 ChatPage | 显示“还没有可用的 AI” + “连接一个 AI →” 链接；无输入框 | [E2E] |
| **TA-12** | 已有一个 ChatGPT 账号 → 再次添加相同 URL | 创建独立新 siteId 记录，两账号 session 和消息历史完全隔离；Tab Bar 可并排显示（label 可重命名） | [手工] |
| **TA-13 TBD** | activeSite.fileUploadTrigger 有值 → 点击 📎 按鈕 | 系统原生文件选择框弹出，选中文件后随 chat:send 一并发送（M11 完成后适用） | TBD |
| **TA-14** | macOS：已连接站点 → Cmd+W 关闭窗口 → 点击 Dock 图标重新打开 | 应用正常显示 ChatPage，站点仍连接，所有 IPC 调用正常工作，无 "Object has been destroyed" 错误（根因：activate 事件需重新创建 BVM 并重注册 IPC） | [手工] |

> *TA-03 `[手工]*`：需真实账号完成登录或高精度 mock 登录页（实现成本高于收益）；其他 `[E2E]` 条目均可用 `e2e/helpers/mock-site.ts` 配合 Playwright 实现。

---

#### 1.2.3 主用户旅程（Happy Path）

从零到收到第一条 AI 回复的完整路径：

| # | 用户动作 | 应用行为 | TA |
|---|---|---|---|
| J-01 | 首次打开应用 | 显示向导页，5 个预设 AI 卡片 | TA-01 |
| J-02 | 点击 Claude 卡片 | Claude 登录页展开（WebContentsView 覆盖） | TA-02 |
| J-03 | 完成 Claude 账号登录 | 登录检测触发，自动收起，跳转 ChatPage，Tab Bar 出现 Claude 标签 | TA-03 |
| J-04 | 输入问题并点击发送 | 用户消息立即追加，输入框 disabled，“Claude 正在生成…” | TA-04 |
| J-05 | 等待回复（≤120s） | AI 回复追加到消息列表，输入框重新 enabled | TA-04 |
| J-06 | 关闭后再次打开 | 直接进入 ChatPage，Claude 标签已在 Tab Bar，无需重新登录 | TA-05 |
| J-07 | 再添加 ChatGPT，重复 J-02～J-03 | 新标签出现，两个 AI 可独立发消息，历史互不干扰 | TA-02、TA-03、TA-09 |

---

#### 1.2.4 自动化验收边界

**核心原则**：
- **自动化能替代的**：「重复路径是否仍可通」——应用能否启动、消息能否在 mock 站点中完成注入和提取、Tab 操作与状态是否同步。这是防止代码改动悸悸破坏已有功能的回归网。
- **自动化不能替代的**：「长期使用是否仍愿意用」——响应时间的直觉感受、失败提示是否给人信任感、多账号管理是否顺手。这些**必须由维护者的狗食测试作出最终裁决**。

**E2E 断言稳健性约束（防回归到脆弱断言）**：
- 对聊天回复类用例（如 TA-04），默认使用“**消息列表容器文本断言**”（`toContainText` / 正则匹配）验证“回复内容已进入用户可见消息流”。
- 避免把 `toBeVisible('某条精确文本')` 作为唯一通过条件。原因：在 Electron + Playwright 场景中，消息气泡可能已在 DOM 中且文本已可读，但受动画、滚动、布局刷新时序影响，短窗口内 `visible` 判定会抖动，造成误报失败。
- 回复提取链路的验收应优先保证“**非空且非兜底错误文案**”（例如不得出现“（回复内容为空，请重试）”），再按需要补充更细粒度断言。
- 若需要验证具体文案（如 mock 回声 `Echo: ...`），可接受“目标回复或稳定历史回复”二选一断言，避免将测试耦合到单一时序快照。
- 只有在测试目标明确是“元素可见性行为”本身时，才应把 `toBeVisible` 设为主断言。

**TA → E2E 映射建议**：

| TA | 推荐覆盖方式 | 建议 spec 文件 |
|---|---|---|
| TA-01 | 空 sites.json 启动，检查向导页元素 | `e2e/startup.spec.ts` |
| TA-02 | mock-site 提供登录页 HTML，验证 WebContentsView 展开 | `e2e/resources-page.spec.ts` |
| TA-03 | **仅手工** | — |
| TA-04 | mock-site 返回固定文本；验证消息追加 + 输入框状态 | `e2e/background-automation.spec.ts` |
| TA-05 | 预置 sites.json + mock-site + 重启，验证 probeAllSites 推送 | `e2e/startup.spec.ts` |
| TA-06 | mock-site 注入 quotaExhaustedIndicator，验证通知文案与 disabled 状态 | `e2e/background-automation.spec.ts` |
| TA-07 | **仅手工** | — |
| TA-08 | **仅手工** | — |
| TA-09 | mock 两个 siteId 站点；验证 Tab 切换后消息过滤 | `e2e/background-automation.spec.ts` 或新增 `e2e/tab-switching.spec.ts` |
| TA-10 | mock site + 点击 × + 验证 Tab 消失与状态同步 | `e2e/resources-page.spec.ts` 或 `e2e/tab-switching.spec.ts` |
| TA-11 | 空 sites.json 启动，验证空态文案 | `e2e/startup.spec.ts` |
| TA-12 | **仅手工** | — |
| TA-13 | TBD（M11 完成后） | — |

> **mock-site 说明**：`e2e/helpers/mock-site.ts` 已提供可本地运行的简单 HTML 站点，可扩展支持 quotaExhaustedIndicator、多 siteId 场景，无需真实 AI 账号即可执行大多数回归用例。
> **命名约定**：新增 spec 文件以功能域命名（如 `tab-switching.spec.ts`），与上表 TA 条目对应，便于失败时快速定位。

---

#### 1.2.5 SPEC 与体验验收的关系

SPEC.md 是本仓库开发与 AI 协作的**唯一真理来源（SSOT）**：功能边界、数据结构、IPC 协议均以本文档为准。
**最终成功的判定以维护者的狗食测试为准**：功能全部实现 ≠ 体验成功；只有维护者在真实工作流中长期使用、无需频繁绕开 autoAI，才构成“感受良好”的充分条件。
§1.2.2 清单 + §1.2.3 旅程 + §1.2.4 自动化映射的作用是：① 防回归；② 为 AI 协作提供“体验对齐”依据；③ 减少重复手工步骤。它们**不声称**已完全替代主观体验验收。

---

#### 1.2.6 与现有章节的对齐说明

- **§6.1（最小验收标准）**：§6.1 描述主进程级别的功能成立条件（IPC 契约、状态机）；§1.2.2 的 TA 条目在此基础上从用户视角重新表达，并增加了 UI 反馈、文案准确性等功能规格未覆盖的维度——两节互补，不重叠。
- **§7.4 额度耗尽通知文案**：原文“请从上方下拉菜单切换…”在 M9 Tab Bar 完成后已不准确；TA-06 采用当前代码实际文案“标签栏”；§7.4 正文已在本次变更中同步更新。
- **§十 各里程碑手工验证条目**（如“M7：5 个网站各通过一次手动测试”）与 TA-04 对应；后续验收以 TA 编号为引用基准，避免在各里程碑中分散重复记录。

---

## 二、核心技术路线

### 2.0 Playwright-first 自动化主路径（SSOT）

> **单一事实**：发送消息的回复链路以 **Playwright CDP 网络观察** 为主路径（可选启用），以既有 **Electron WebContentsView + `fetch` 包装拦截 + DOM 稳定 watcher** 为 **Legacy 兜底**。作者标签（author-label）过滤在 **主进程 automation/reply-pipeline** 单点执行；渲染进程仍可做 UI 层防御性过滤，但不得依赖其为唯一正确性来源。

#### 2.0.1 模式与环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `AUTOAI_AUTOMATION_MODE` | `legacy` | `playwright`：全局优先走 Playwright-first（仍需 CDP 可用）。 |
| `AUTOAI_PLAYWRIGHT_HOSTS` | *(空)* | 逗号分隔子串灰度；**非空时仅此列表匹配的 hostname 走 Playwright**，其余固定 Legacy（优先于 `AUTOAI_AUTOMATION_MODE`）。 |
| `AUTOAI_CDP_PORT` | `9223` | Electron `--remote-debugging-port`，供 `connectOverCDP`。 |
| `AUTOAI_ENABLE_CDP` | *(未设置)* | 任意非空即强制开启 CDP 端口（便于在未切 `playwright` 模式下调试）。 |

启用 Playwright 路径时，主进程在启动早期追加：`remote-debugging-port`、`remote-allow-origins=*`（见 `src/main/index.ts`）。

#### 2.0.2 判定与降级（fallback）

1. **Legacy**：默认；或灰度未命中；或 `connectOverCDP` 失败；或 CDP 无法在多条同源页面中 **唯一** 对齐当前 `WebContents.getURL()`（多账号同 hostname 且 URL 规范化后相同 → 强制 Legacy SSE，以免监听错页）。
2. **Playwright-first**：模式命中 **且** CDP 连接成功 **且** `pickPageForWebContents` 将 CDP `Page` 与 **`webContents.getURL()`** 规范化对齐成功 **或为该 hostname 下唯一候选页**；SSE 观测走 Playwright `response` 监听 + `sse-parse`，与 DOM watcher **并行**，由 `raceReply` **单次决胜**。
3. **双方共享**：注入发送、`watchForReply` DOM 路径、`raceReply` 语义、`networkInterceptorAccepted`（含作者标签拒绝）、配额耗尽、`chat:busy` 全局互斥。

#### 2.0.3 网络 / 证书 / 代理分层诊断

- **APP**：`proxy-server` 是否与 `HTTP(S)_PROXY` 一致生效。
- **SESSION**：抽样 `session.resolveProxy(url)` 是否为直连偏离。
- **BACKEND**：环境变量是否在子进程/CLI 侧仍可读取（与 app 层对齐）。
- 运行时 **`site:refresh-network-diagnostics`** 复用与启动相同的 `runProxyConsistencyCheck`（见 `src/main/network-diagnostics.ts`）。
- **最近发送失败**：`site:get-last-chat-failure` 暴露最后一次超时/CDP/导航中断等摘要（`src/main/chat-failure-log.ts`），ResourcesPage 稳定性面板展示修复建议文案映射。

#### 2.0.4 回复链路 SLA（验收）

- **首包**：仍以站点真实 SSE 为准；本应用不伪造首 token 时间戳，仅记录日志路径（`playwright` vs `legacy`）。
- **正文**：不得以独立作者标签作为最终 `chat:reply` 正文（与既有 `isLikelyAuthorLabel` 回归一致）。
- **超时**：120s 硬上限保持；若超时且无正文，应触发页面文案嗅探 `getTimeoutFailureHint`，区分证书/网络/风控（见 `chat-reply-race.ts`），并写入 `ChatFailureRecord`。
- **中断**：发送期间 **跨文档主框架导航**（`did-start-navigation` 且 `isSameDocument === false`）记 **`chat-interrupted`**；忽略 SPA **同文档**导航（`pushState` / hash 等，`isSameDocument === true`），避免误判。

#### 2.0.5 可观测性与恢复

- 既有 `site:runtime-event` 管道保持不变；新增类别 **`chat-interrupted`**（renderer/preload 类型已扩展）。
- 恢复策略仍服从 `RuntimeRecoveryPolicy`（窗口内计数 + auto-recreate vs manual-check）。

#### 2.0.6 回滚策略

- 设置 **`AUTOAI_AUTOMATION_MODE=legacy`** 并清空 **`AUTOAI_PLAYWRIGHT_HOSTS`** → 行为与迁移前主路径等价（仍为 Electron legacy 拦截实现）。
- Playwright 依赖仅在 **`dependencies`** 的 `playwright`；未启用 CDP 时不强制初始化浏览器驱动逻辑。

#### 2.0.7 代码映射（维护者速查）

- `src/main/automation/chat-dispatcher.ts` — 模式选择 + Legacy/Playwright 拦截器装配。
- `src/main/automation/reply-pipeline.ts` — 注入 + `raceReply` + `chat:reply`。
- `src/main/automation/playwright-network.ts` — CDP 连接与 SSE `response` 监听。
- `src/main/automation/legacy-interceptor.ts` — 原有二次 arm 逻辑。
- `src/main/ipc.ts` — `chat:send` 仅校验与 `dispatchChatSend` 委派。

#### 2.0.8 本地 Adapter（OpenAI 兼容最小接口，当前已实现）

> 目标：让外部本地工作流平台以 API 方式调用 autoAI，而不改变“网页自动化替代 API”的核心路线。

- 默认启动：随主进程启动（可通过环境变量关闭）。
- 默认地址：`http://127.0.0.1:8787`
- 环境变量：
  - `AUTOAI_ADAPTER_ENABLE`（默认启用；设 `0` 关闭）
  - `AUTOAI_ADAPTER_HOST`（默认 `127.0.0.1`）
  - `AUTOAI_ADAPTER_PORT`（默认 `8787`）
- 当前接口：
  - `GET /health`
  - `GET /v1/models`
  - `POST /v1/chat/completions`（当前先支持 `stream=false`）

**model → siteId 映射顺序（当前实现）**：
1. `model === siteId`
2. `model === activeModel`
3. 命中 `availableModels[].id`
4. `hostname` 包含 `model`（兜底）

**调用链路（当前实现）**：
- Adapter 收到请求 → 映射站点 → 调用主进程 `dispatchChatSend` → 以 `sendSeq` 等待本轮 settled 事件 → 返回 OpenAI 兼容格式。
- 失败时附带最近失败快照摘要（用于上层诊断）。

**代码映射**：
- `src/main/adapter/local-adapter.ts`
- `src/main/automation/adapter-events.ts`
- `src/main/automation/chat-dispatcher.ts`（返回 `sendSeq`）
- `src/main/automation/reply-pipeline.ts`（发送 settled 事件）
- `src/main/index.ts`（Adapter 生命周期 + `adapter:get-info`）

#### 2.0.9 结构化失败快照与门禁（当前已实现）

为支持“自动定位 + CI 门禁”，失败产物升级为结构化事件流：

- 产物文件：
  - `artifacts/failure-snapshot.json`
  - `artifacts/failure-snapshot.events.ndjson`
- 关键字段（单条事件）：
  - `errorCode`
  - `stage`
  - `sendSeq`
  - `path`
  - `siteId`
  - `retryable`
- 聚合统计：
  - `summary.byErrorCode`
  - `summary.byStage`
  - `gate.passed`

**门禁阈值环境变量**：
- `AUTOAI_CI_MAX_FAILURES`（默认 `0`）
- `AUTOAI_CI_MAX_UNKNOWN`（默认 `0`）

**脚本映射**：
- `scripts/extract-failure-snapshot.js`（结构化导出 + gate）
- `scripts/check-adapter-gates.js`（门禁检查）
- `scripts/run-regression-loop.js`（串联 typecheck/test/snapshot/gates）

---

### 问题：每个网站的 DOM 结构不同，如何通用？

传统方案：为每个网站写死 CSS 选择器 → 网站改版立刻失效。

**autoAI 的方案：启发式自动识别 + 用户辅助校准**

### 2.1 输入框自动识别（按优先级依次尝试）

```
优先级 1: [role="textbox"]           — 最标准的 ARIA 语义
优先级 2: div[contenteditable="true"] — 富文本编辑器通用模式
优先级 3: textarea                   — 传统文本框
优先级 4: 靠近页面底部的可编辑元素   — 位置启发式
优先级 5: 用户手动校准结果           — 兜底，100% 准确
```

选中候选元素后，还需验证：
- 元素在视口内可见
- 附近 200px 内存在可点击的按钮（发送按钮）
- 元素当前未被 disabled

### 2.2 发送按钮识别

在输入框周围查找：
```
1. button[type="submit"]
2. 含 "send"/"发送"/"submit" 文字或 aria-label 的 button
3. 输入框同一个表单容器内的最后一个 button
4. 用户手动校准
```

### 2.3 回复完成检测（核心算法：文字稳定法）

**不依赖任何网站特有的 DOM 属性**，改用通用的稳定性检测：

```
消息发送后 → 等待 800ms（让页面开始生成）
    ↓
记录 responseSelector 命中元素的初始计数 adjustedBeforeCount
    ↓
启动 MutationObserver 监听整个对话容器
    ↓
持续观测：
  ├─ DOM 有变化 → 重置稳定计时器，继续等待
  ├─ 元素计数下降（currentCount < adjustedBeforeCount）
  │      → SPA 页面重渲染，重置基线：adjustedBeforeCount = currentCount
  │      → 记录警告日志，继续等待（不视为失败）
  └─ 连续 1500ms 无变化 + currentCount > adjustedBeforeCount + 最后一个元素 innerText 非空
         → 判定"生成完毕"
    ↓
提取最后一条 AI 消息文字
    ↓
停止 MutationObserver，返回结果
```

**SPA 重渲染容错说明（来源：DOM_DETECTION_SYSTEM.md §5.2 RC-3）**：

ChatGPT 等 SPA 在发送 prompt 后会重建 DOM，导致响应元素计数短暂下降到 0，然后再重新增长。若不处理此情况，`currentCount > adjustedBeforeCount` 的条件永远不会在重渲染后成立，最终 120 秒超时。`adjustedBeforeCount` 重置解决了这个问题。

**空容器误判说明（已修复 Bug）**：

ChatGPT 等 SPA 在 API 请求发出后，会先插入一个**空的** assistant 容器（`innerText = ''`），然后等服务器响应才开始填充文字。若此时 DOM 恰好 1500ms 无变化（网络延迟），`onStable` 会提前触发并返回空文本。

修复策略：`onStable` 在 `currentCount > adjustedBeforeCount` 成立后，额外检查 `innerText.trim().length > 0`；若为空则继续等待，直到内容出现后再判定完毕。

超时保护：最长等待 120 秒，超时后返回已抓取到的内容（即使不完整）。

---

### 2.3-bis 回复检测优先级：网络拦截（首选）+ DOM 稳定法（兜底）

> **设计动机**：DOM 选择器与 AI 网站的 HTML 结构高度耦合，网站每次改版都可能导致提取失败。  
> 网络拦截在协议层工作，**完全不依赖 DOM 结构**，是更稳定的根本解决方案。

**两层检测策略**：

```
消息发送后：
  Layer 1（首选）— 网络拦截（network-interceptor.ts）
    ├─ 已配置 ssePattern？
    │    ├─ 是 → 附加 DevTools debugger，启用 Network domain
    │    │      → 匹配 ssePattern 的 URL → 拦截并解析 SSE 流
    │    │      → 用 sseDataExtractor 逐行提取增量文字
    │    │      → loadingFinished → 返回完整文字（无需 DOM）
    │    └─ 否 → 立即跳到 Layer 2
    └─ debugger 附加失败 / 120s 超时 → 记录 warn，降级到 Layer 2

  Layer 2（兜底）— DOM 稳定法（response-watcher.ts）
    └─ 按 §2.3 的 MutationObserver 流程执行
```

**实现方式（`network-interceptor.ts`）**：

Electron 的 `session.webRequest` 无法直接读取响应体。采用 **DevTools Protocol 的 Network domain** 通过 `webContents.debugger`：

```
webContents.debugger.attach('1.3')
    ↓
debugger.sendCommand('Network.enable')
    ↓
监听 debugger 事件：
  - Network.responseReceived → 过滤匹配 ssePattern 的 requestId
  - Network.dataReceived     → 累积已接收字节数（用于日志）
  - Network.eventSourceMessageReceived → 直接获取解析后的 SSE data 字段
    ↓
逐 data 行用 sseDataExtractor 提取增量文字，拼接 fullText
    ↓
Network.loadingFinished（对应 requestId）→ resolve(fullText)
```

**`SiteConfig` 新增字段**（仅含已知 SSE pattern 的预设站点需要；其余站点自动走 DOM 方案）：

```typescript
/** SSE/流式响应的 URL 匹配模式（正则字符串）。空值 = 使用 DOM 稳定法 */
ssePattern?: string
/** 从单个 SSE data chunk 提取增量文字的函数字符串。
 *  接收参数：line（单行 SSE data 内容，不含 "data: " 前缀），返回增量文字 | null（忽略此行）
 *  在主进程 Node.js 环境中通过 new Function('line', body) 执行，无浏览器沙箱风险。 */
sseDataExtractor?: string
```

**内置预设（`presets.ts`）**：

| 站点 | ssePattern | sseDataExtractor 逻辑 |
|---|---|---|
| ChatGPT | `\/backend-api\/conversation` | 解析 `{"v":"..."}` 增量块；遇到 `[DONE]` 返回 null |
| Claude | `\/api\/organizations\/.*\/chat_conversations\/.*\/completion` | 解析 `{"type":"content_block_delta","delta":{"text":"..."}}` |

**优先级与降级规则**：
- `ssePattern` 非空且 debugger 可附加 → 使用网络拦截（Layer 1）
- `ssePattern` 为空、debugger 附加失败、或 120s 内未收到 `loadingFinished` → 降级 DOM 稳定法（Layer 2）
- 两种方式返回相同的 `WatchResult` 类型，`ipc.ts` 无需区分
- 降级时记录 `log.warn`，不向渲染进程暴露，用户无感知

**不拦截、不修改**：仅只读访问响应流数据，不修改请求或响应内容，不影响页面正常渲染。

---

### 2.4 回复内容提取

提取顺序（按可靠性）：
```
1. [role="log"] 或 [role="feed"] 容器内最后一个子块
2. 对话容器内最后一个与用户消息不同来源的文字块
3. 页面中 DOM 变化最集中区域的最终文字内容
4. 用户校准指定的"回复容器"内最后一段文字
```

### 2.5 用户辅助校准（兜底机制）

当自动识别失败时（注入失败 或 等了 30 秒没有检测到任何 DOM 变化，即选择器探测阶段超时；与 §2.3 的 120 秒回复等待超时不同）：

```
弹出引导覆层：
  步骤 1/2: "请点击页面上你输入消息的地方"  → 高亮用户点击的元素
  步骤 2/2: "请点击一条 AI 的回复"          → 记录回复所在容器

保存到本地（写入当前账号记录）：
  将结果写入当前 `siteId` 对应的 `SiteConfig`；`hostname` 仅用于匹配 preset，不作为唯一键
```

下次使用同一账号（同一 `siteId`）时自动使用已校准的选择器；同域名的其他账号默认不继承。

### 2.6 Selector Debugger（UI 驱动的选择器维护）

即使校准过，网站改版后选择器仍可能失效。**Selector Debugger** 让用户无需改代码即可修复：

```
ResourcesPage 中每个网站卡片右下角有「调试选择器」按钮
  ↓
展开面板，显示该网站当前所有已保存的选择器字段：
  - inputSelectors        (输入框；UI 直接编辑当前最高优先级策略)
  - sendSelectors         (发送按钮；UI 直接编辑当前最高优先级策略)
  - responseSelectors     (回复容器；UI 直接编辑当前最高优先级策略)
  - quotaExhaustedIndicator (额度用尽标识)
  - fileUploadTrigger     (附件按钮，可选)
  ↓
用户可直接编辑文本框，点击「保存」写入 site-store
也可点击「重新校准」回到两步引导覆层流程
```

这是 demo 验证过的最低摩擦修复路径：网站改版 → 打开 Selector Debugger → 粘贴新选择器 → 问题立即解决，全程不需要更新软件版本。

### 2.7 额度耗尽检测

部分网站会在免费额度用完时显示特定提示（如"You've reached the usage cap"）。`response-watcher.ts` 在等待回复的同时并行检测此标识：

```
发送消息后，MutationObserver 监听期间并行：
  每 2 秒检查一次 quotaExhaustedIndicator 是否出现
    ├─ 检测到 → 立即停止等待，触发 chat:quota-exhausted IPC
    └─ 未检测到 → 继续等待 DOM 稳定
```

`quotaExhaustedIndicator` 存储在 `SiteConfig` 中，支持两种格式：
- CSS 选择器：`'.quota-banner'`
- 文字匹配：`'text=You\'ve reached the usage cap'`

用户可通过 Selector Debugger 维护此字段，无需等待软件更新。

---

### 2.8 文件上传（附件注入）

> ❗ **实现状态：本节为规划契约，当前未实现。** 代码现状：`SiteConfig.fileUploadTrigger` 字段已存在（`site-store.ts`、SelectorDebugger 可编辑），preload 的 `chat:send` 会透传 `attachments` 参数，但主进程 `ipc.ts` 的 `chat:send` 处理器仅接收 `(siteId, text)`，无附件注入逻辑；`dialog:open-file` IPC 未注册；`presets.ts` 未含 fileUploadTrigger 预设；📎 按钮 UI 未实现。

用户在聊天输入框点击 📎 按钮，将文件（图片、文档、代码文件等）一同发送给 AI。

**触发条件**：`SiteConfig.fileUploadTrigger` 有值时，输入框左侧显示附件按钮。

**完整链路**：

```
用户点击 📎 按钮
    ↓
渲染进程 → dialog:open-file IPC → Electron dialog.showOpenDialog（系统原生文件选择器）
    ↓
返回选中的本地文件路径数组（用户取消则空数组，不继续）
    ↓
chat:send 附带 attachments: string[]（本地文件路径）
    ↓
主进程：注入文字前，先处理附件：
  1. 在后台 WebContentsView 中查找 fileUploadTrigger 选择器命中的元素
  2. 若命中的是触发按钮（非 <input type="file">）：先 click()，等待隐藏的 file input 出现
  3. 通过 Electron Debugger Protocol 直接注入文件路径：
     webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: attachments })
  4. 等待 AI 网站完成上传（检测文件预览卡片出现，超时 15s）
    ↓
附件上传完成后，正常执行文字注入 + 发送流程（文字可为空，仅发文件）
```

**Debugger Protocol 说明**：`webContents.debugger` 通过 `debugger.attach('1.3')` 连接，`DOM.setFileInputFiles` 直接写入文件路径而无需弹系统文件选择对话框，绕过渲染进程沙箱限制。

**fileUploadTrigger 格式语义**：
- 直接是 `<input type="file">` 的选择器（如 `input[type="file"]`）：直接执行 `DOM.setFileInputFiles`
- 是触发按钮的选择器（如 `button[aria-label="Attach files"]`）：先 click，等待 file input 出现后再注入

**安全约束**：文件路径仅在主进程处理，preload 层只暴露 `dialog:open-file` IPC（触发对话框并返回路径数组），不向渲染进程暴露 `fs` 模块。

**预设文件上传选择器**（规划值，待实现时在 `presets.ts` 维护；当前 `presets.ts` 无此字段）：

| 网站 | fileUploadTrigger |
|---|---|
| ChatGPT | `button[aria-label="Attach files"]` |
| Claude | `button[aria-label="Add content"]` |

---

### 2.9 模型切换（Model Switcher）

ChatGPT、Claude 等网站支持在同一账号内切换 AI 模型（如 GPT-4o → o1 → o3-mini）。autoAI 通过注入 DOM 点击脚本实现切换，无需 API Key。

**SiteConfig 新增字段**（完整定义见 §4 `site-store.ts`）：
- `modelSwitcherSelector`：打开模型选择下拉框的按钮选择器（空值 = 不支持模型切换）
- `availableModels`：该账号已知的 `ModelOption` 列表（来自预设；若需手动维护，具体编辑交互 TBD）
- `activeModel`：当前选中的模型 ID，持久化到 `site-store`

**切换流程**：

```
用户在 ChatPage 的模型子菜单中选择 "o1"
    ↓
渲染进程 → chat:switch-model IPC，payload: { siteId, modelId: 'o1' }
    ↓
主进程：
  1. 执行 modelSwitcherSelector.click()（打开模型下拉框）
  2. 等待下拉框出现（最多 800ms）
  3. 查找 availableModels[i].selector 命中的选项元素并 click()
  4. 更新 SiteConfig.activeModel，写入 site-store
    ↓
返回 { ok: true }；渲染进程更新模型名称显示
```

**失败处理**：选择器不存在或点击无效时返回 `{ ok: false, error: 'selector-not-found' }`，不影响后续消息发送（继续使用 AI 网站当前默认模型）。

**默认禁用**：`modelSwitcherSelector` 初始值为空，不自动启用。用户可通过 Selector Debugger 填入后激活。

**对话线程语义**：切换模型等价于开启新的对话线程。本地消息镜像（`messages` 状态）仅反映当前线程内的交互；切换后旧线程消息自动清空，客户端不恢复旧线程消息历史。无需切换前确认对话框——与 AI 网站自身"新对话"语义一致。

**预设模型列表**（`presets.ts` 维护，供渲染层展示菜单）：

| 网站 | 已知模型 |
|---|---|
| ChatGPT | GPT-4o, o1, o3, o4-mini |
| Claude | Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| Gemini | Gemini 2.5 Pro, Gemini 2.0 Flash |

**UI 呈现**：当 `activeSite.availableModels` 非空时，当前站点切换控件旁显示当前模型名（如 `Claude · 3.7 Sonnet`），展开可切换。

### 2.10 安全、隐私与合规边界

- 主窗口渲染进程启用 `contextIsolation`；preload 只暴露白名单 IPC，不向渲染进程暴露 `fs`、shell 或任意脚本执行能力。
- 用户自定义 URL 仅在沙箱化的 `WebContentsView` 中加载；是否能被自动化不做保证。
- 自动化行为必须由用户显式触发（添加站点、登录、发送、上传、校准）；不做未经确认的后台批量抓取或连续操作。
- Session、Cookie 与站点登录态只保存在本机 Electron Session 分区；日志默认不得记录 prompt 正文、AI 回复全文、cookie、token 或附件绝对路径。
- 待确认：未来是否允许用户脚本 / 自定义注入脚本。当前版本默认不支持。

---

## 三、项目文件结构

> 注：本节强调职责边界，不强制“一组件一文件”；未单独拆出的 UI 片段可暂以内联子组件存在于页面文件中。

```
autoAI/
├── package.json                # 依赖声明
├── tsconfig.json               # TypeScript 配置
├── tsconfig.node.json          # 主进程 TypeScript 配置
├── tsconfig.web.json           # 渲染进程 TypeScript 配置
├── electron.vite.config.ts     # electron-vite 构建配置
│
└── src/
    ├── main/                   # Electron 主进程（Node.js 环境）
    │   ├── index.ts            # 入口：创建窗口、注册 IPC
    │   ├── session.ts          # 浏览器会话管理（登录态持久化）
    │   ├── browser-view.ts     # WebContentsView 生命周期管理
    │   ├── detector.ts         # 自动识别引擎（输入框/发送按钮/回复容器）
    │   ├── injector.ts         # 消息注入引擎（写入文字 + 点击发送）
    │   ├── network-interceptor.ts # 网络拦截引擎（SSE 流提取，§2.3-bis，首选方案）
    │   ├── response-watcher.ts # 回复完成检测（MutationObserver，DOM 兜底方案）
    │   ├── site-store.ts       # siteId→SiteConfig 映射，持久化到 JSON 文件
    │   └── ipc.ts              # 所有 IPC 通道的注册和处理
    │
    ├── preload/
    │   └── index.ts            # contextBridge 暴露给渲染进程的 API
    │
    └── renderer/               # React UI（浏览器环境）
        ├── index.html          # 渲染进程入口 HTML
        └── src/
            ├── main.tsx            # React 入口
            ├── App.tsx             # 路由和整体布局
            │
            ├── pages/
            │   ├── ResourcesPage.tsx   # AI 资源设置页（新用户向导 + 设置入口）：可用/不可用分区、登录引导、添加自定义网站
            │   └── ChatPage.tsx        # 首页聊天界面（顶部栏下方：消息列表 + 输入框；M12 前无侧边栏）
            │
            └── components/
                ├── SelectorDebugger.tsx    # Selector Debugger：5 个选择器字段直接编辑 + 保存
                └── CalibrationOverlay.tsx  # 用户辅助校准的引导覆层（两步点击流程）
```

---

## 四、各模块职责边界

### `session.ts` — 会话管理

**做什么**：
- 为每个 `siteId` 创建独立的 Electron Session（`persist:autoai-{siteId}`）
- Session 数据存储在磁盘，关闭软件不丢失
- 提供 `getSession(siteId)` / `clearSession(siteId)` 接口

**不做什么**：
- 不管理登录逻辑（用户自己在 WebContentsView 里登录）
- 不清除 Session（用户主动"断开连接"时才清）

---

### `browser-view.ts` — 浏览器视图管理

**做什么**：
- 创建和销毁 `WebContentsView` 实例
- 控制视图的显示/隐藏（聊天时隐藏，登录时显示给用户看）
- 导航到指定 URL

**不做什么**：
- 不注入脚本（由 `injector.ts` 和 `response-watcher.ts` 负责）
- 不管理 Session（由 `session.ts` 负责）

---

### `detector.ts` — 自动识别引擎

**做什么**：
- 在 WebContentsView 中执行 JavaScript，找到输入框和发送按钮
- 按优先级依次尝试各种选择器策略，返回命中的 `SelectorStrategy`
- **收敛的 responseBlock 候选列表**（语义属性优先，避免宽泛 class 名误判）：
  ```
  [data-message-author-role="assistant"]
  [class*="markdown"][class*="message"]
  .model-response-text
  .ds-markdown
  [class*="response-container"] [class*="markdown"]
  .prose
  ```
- 探测结果作为 `priority: 3` 的策略追加到 `SelectorChain`（不替换现有策略）
- 结果保存到 `site-store.ts`

**关键约束（来源：DOM_DETECTION_SYSTEM.md §4.2 原则一）**：
- 若 `SiteConfig.calibrated === true`，`detector.ts` 跳过 `inputSelectors`、`sendSelectors`、`responseSelectors` 的写入，用户的精确校准结果不得被自动探测覆盖
- 自动探测在后台异步进行（不阻塞发送流程），失败时降级到现有链中优先级最高的策略

**不做什么**：
- 不执行注入（只负责"找"，不负责"用"）
- 不处理校准流程（由 `ipc.ts` 协调）

---

### `injector.ts` — 消息注入引擎

**做什么**：
- 接收文字内容 + 选择器，把文字注入到输入框
- 触发框架的 onChange 事件（兼容 React/Vue/原生）
- 点击发送按钮
- 返回注入是否成功

**核心兼容性处理**：
```typescript
// 策略1: React 内部 setter（绕过 React 虚拟 DOM）
// 策略2: 模拟 clipboard paste（适用于富文本编辑器）
// 策略3: 直接赋值 + 触发 input/change 事件（传统表单）
```

**关键时序约束**：注入文字后必须等待足够时间（≥600ms）再点击发送按钮。原因：ChatGPT 等 React SPA 的发送按钮在输入框为空时处于 `disabled` 状态，React 需要一次事件循环来处理 `InputEvent` 并将按钮切换为 enabled。过早点击会命中 disabled 状态，`el.click()` 被 React 忽略，消息不会发出。

**发送按钮 disabled 检测**：`buildClickScript` 在执行 `el.click()` 前先检查 `el.disabled || el.getAttribute('aria-disabled') === 'true'`，若为 disabled 则返回 `{ ok: false }`，触发 Enter 键回退路径而非静默失败。

**InputEvent 兼容性**：所有手动派发的 `InputEvent` / `KeyboardEvent` 必须携带 `composed: true`，确保事件能穿透 Shadow DOM 边界到达 React 合成事件系统。

**不做什么**：
- 不等待回复（注入完成即返回）

---

### `network-interceptor.ts` — 网络拦截引擎（首选）

**做什么**：
- 为指定 `WebContentsView` 附加 Electron DevTools Debugger（`webContents.debugger.attach('1.3')`）
- 启用 `Network` domain，监听匹配 `ssePattern` 的 HTTP 响应流
- 通过 `Network.eventSourceMessageReceived` 事件逐行解析 SSE data 字段
- 用 `sseDataExtractor` 函数字符串（`new Function('line', body)`）提取增量文字，拼接完整回复
- 响应结束（`Network.loadingFinished`）时返回 `WatchResult`
- 完成后立即 `debugger.detach()`，不常驻

**降级触发条件**：
- `ssePattern` 为空 → 立即返回 `null`
- `debugger.attach()` 抛出异常 → `log.warn` + 返回 `null`
- 120s 内未收到对应 `requestId` 的 `loadingFinished` → 返回已累积内容，`timedOut: true`

**不做什么**：
- 不修改请求或响应内容（只读）
- 不处理 `outputType !== 'text'` 的场景（图片/视频继续走 DOM 方案）
- 不管理 `response-watcher.ts` 的生命周期

---

### `response-watcher.ts` — 输出完成检测（DOM 兜底）

**做什么**：
- 接收 `responseSelectors: SelectorChain` + `outputType` + `quotaExhaustedIndicator`
- 按链中优先级解析出当前有效选择器，在页面中注入 MutationObserver 脚本
- **SPA 重渲染容错**：记录初始元素计数 `adjustedBeforeCount`，检测到计数下降时重置基线（而非报错），继续等待后续增长
- **并行检测额度耗尽**：每 2 秒检查 `quotaExhaustedIndicator` 是否出现，检测到则立即停止等待，返回 `{ quotaExhausted: true }`
- 等待 DOM 连续 1500ms 无变化 → 判定生成完毕
- 根据 `outputType` 决定提取方式：
  - `text`：读取容器的 `innerText`
  - `image`：查找容器内的 `<img>` 标签，收集 `src` URL
  - `video`：预留接口，暂不实现（返回空结果）
- 返回 `AutomationResult`，处理超时

**不做什么**：
- 不决定"容器是哪个"（由 `detector.ts` 或 `site-store.ts` 提供）
- 不处理图片下载/视频合成（只负责"拿到 URL"，下载由上层业务负责）

---

### `site-store.ts` — 站点配置存储

**做什么**：
- 按 `siteId` 存储单个账号的已识别/已校准选择器（`SelectorChain` 格式）
- JSON 文件持久化（`userData/sites.json`）
- 提供 `get(siteId)` / `list()` / `add(url)` / `remove(siteId)` / `rename(siteId, label)` / `updateSelectors(siteId, ...)` / `setQuotaExhausted(siteId, bool)` 等接口

**校准保护规则（来源：DOM_DETECTION_SYSTEM.md §4.2 原则一）**：

`updateSelectors()` 的合并策略取决于调用来源：

| 调用来源 | 行为 |
|---|---|
| `CalibrationOverlay` / `SelectorDebugger`（用户操作） | 用 `priority: 10` 的新策略替换同字段已有策略，同时将 `calibrated` 设为 `true` |
| `detector.ts`（自动探测） | **若 `calibrated === true`，跳过 `inputSelectors` / `sendSelectors` / `responseSelectors` 三个字段的写入**；`quotaExhaustedIndicator` 和 `fileUploadTrigger` 不受此保护 |
| 健康追踪更新（`lastWorked` / `failCount`） | 始终允许更新，不影响 `calibrated` 标志 |

**理由**：自动探测只能验证"元素存在"，无法确认是否是正确的目标。用户校准的选择器有人工语义验证，不应被低可信度的探测结果冲掉。

**数据结构**：
```typescript
type OutputType = 'text' | 'image' | 'video'

/**
 * 单个选择器策略，带优先级和健康追踪。
 * 来源：DOM_DETECTION_SYSTEM.md §4.1 — 五层降级选择器解析链
 */
interface SelectorStrategy {
  selector: string       // CSS 选择器 | "text=..." | "role=..." | "testid=..."
  method: 'css' | 'text' | 'role' | 'testid' | 'xpath'
  priority: number       // 数字越大越优先（默认优先级：自动探测=3, 预设=5, 用户校准=10）
  lastWorked?: string    // ISO 时间戳，最近一次成功时间（undefined = 从未用过）
  failCount: number      // 连续失败次数，累计到阈值（默认 3）时触发重探测
}

/** 同一字段的多策略降级链，按 priority 降序排列，第一个成功即使用 */
type SelectorChain = SelectorStrategy[]

/** 模型切换用：单个可用模型的元数据（见 §2.9） */
interface ModelOption {
  id: string         // e.g. 'gpt-4o'、'o1'
  label: string      // 显示名称，e.g. 'GPT-4o'、'o1'
  selector?: string  // 在模型下拉框中点击该选项的 CSS 选择器
}

interface SiteConfig {
  siteId: string                     // UUID，单个账号记录的稳定唯一键
  hostname: string                   // e.g. "chatgpt.com"
  label: string                      // e.g. "ChatGPT"
  url: string                        // 初始导航地址
  outputType: OutputType             // 决定提取方式：读文字 / 抓图片URL / 下载文件
  inputSelectors: SelectorChain      // 输入框多策略降级链（自动探测结果 + 用户校准）
  sendSelectors: SelectorChain       // 发送按钮多策略降级链
  responseSelectors: SelectorChain   // 回复容器多策略降级链
  quotaExhaustedIndicator?: string   // 额度用尽检测：CSS选择器 或 "text=..." 前缀的文字模式（用户维护）
  fileUploadTrigger?: string         // 附件按钮选择器（可选，用户维护；详见 §2.8）
  modelSwitcherSelector?: string     // 模型切换按钮选择器（空值 = 不支持模型切换；详见 §2.9）
  availableModels?: ModelOption[]    // 该账号已知可用模型列表（来自预设；手动维护入口 TBD）
  activeModel?: string               // 当前选中的模型 ID（如 'gpt-4o'）；undefined 表示使用 AI 网站默认
  ssePattern?: string                // §2.3-bis：SSE/流式响应的 URL 匹配正则字符串；空值 = DOM 稳定法
  sseDataExtractor?: string          // §2.3-bis：从单行 SSE data 提取增量文字的 JS 函数体字符串
  calibrated: boolean                // true = 用户手动校准过；自动探测不得覆盖已校准字段
  addedAt: number                    // 时间戳
  quotaExhausted?: boolean           // 最近一次探测到该账号免费额度用尽时为 true；用于重启后的状态恢复
  connected?: boolean                // 最近一次探测到的登录状态（持久化，重启后恢复显示）
  toolToggles?: ToolToggle[]         // M12-工具开关：站点支持的可切换工具列表（如联网搜索）
  activeTools?: string[]             // 当前已开启的工具 id 列表
  effortLevels?: EffortLevel[]       // M13-Effort 档位：站点支持的推理强度选项
  effortMenuTriggerSelector?: string // 打开 Effort 菜单的触发按钮选择器
  activeEffort?: string              // 当前选中的 Effort 档位 id
}

/**
 * readyIndicator 不作为独立字段存储。
 * 登录成功检测策略：500ms 首检 + 每 1.5 秒轮询，对页面执行 inputSelectors[0].selector 的 querySelector，
 * 若返回非空可见元素则判定登录完成，最长等待 5 分钟（实现见 browser-view.ts startLoginPoll）。
 * 理由：输入框出现 = 网站已加载完毕且用户已登录，与 inputSelectors 复用同一来源，无需维护额外字段。
 */

// 自动化引擎的统一输出类型
interface AutomationResult {
  outputType: OutputType
  quotaExhausted?: boolean   // 发现额度用尽标识时为 true
  text?: string              // outputType === 'text'
  imageUrls?: string[]       // outputType === 'image'，可能多张
  videoUrl?: string          // outputType === 'video'，预留，暂不实现
}
```

**选择器链优先级设计**：

| 来源 | priority | 说明 |
|---|---|---|
| 用户手动校准 | 10 | 最高优先级，`calibrated: true` 时自动探测不得写入 |
| 内置预设（已验证选择器） | 5 | 随软件分发，经过测试验证 |
| 自动探测结果 | 3 | 启发式识别，可能不稳定 |

**降级执行策略**：`detector.ts` 按 `priority` 从高到低依次在页面中执行 `querySelector`，第一个命中可见元素的策略即为本次使用的选择器。失败时 `failCount++`，成功时更新 `lastWorked` 并重置 `failCount`。

---

### `ipc.ts` — IPC 通道总表

**并发限制**：第一版不支持多 AI 并发发送。任何 AI 生成期间，渲染进程输入框全局 disabled；生成完毕（收到 `chat:reply` 或 `chat:quota-exhausted`）才解锁。主进程收到第二条 `chat:send` 时直接返回错误 `{ error: 'busy' }`（防御性兜底）。

**标识规则**：所有针对单个账号的 IPC 都以 `siteId` 作为唯一标识；`hostname` 仅用于显示和 preset 查找。

| 通道名 | 方向 | 说明 |
|---|---|---|
| `site:add` | 渲染→主 | 添加新网站（提供 URL） |
| `site:remove` | 渲染→主 | 删除网站（提供 `siteId`） |
| `site:list` | 渲染→主 | 返回 `Array<SiteConfig & { status: 'connected' \| 'disconnected' \| 'quota-exhausted' \| 'loading' }>` |
| `site:open-login` | 渲染→主 | 打开登录窗口（显示对应 `siteId` 的 WebContentsView） |
| `site:close-login` | 渲染→主 | 关闭当前登录窗口 |
| `site:close-all-logins` | 渲染→主 | 关闭所有当前可见的登录窗口 |
| `site:update-selectors` | 渲染→主 | Selector Debugger 保存修改后的选择器（提供 `siteId` + 字段对象） |
| `site:rename` | 渲染→主 | 修改账号显示名称（提供 `siteId` + `label`） |
| `site:show-view` | 渲染→主 | 显示真实 AI 网页（Browse 模式协议入口） |
| `site:hide-view` | 渲染→主 | 收起真实 AI 网页，返回 Chat UI |
| `site:check-quota` | 渲染→主 | 主动检查额度耗尽标识是否已消失 |
| `site:status-changed` | 主→渲染 | 推送某个 `siteId` 的状态变化 |
| `site:login-success` | 主→渲染 | 推送某个 `siteId` 登录检测成功 |
| `chat:send` | 渲染→主 | 发送消息（提供 `siteId` + `text`）。⚠️ preload 会透传可选 `attachments` 路径数组，但主进程处理器当前忽略该参数（附件上传未实现，见 §2.8）；M12 后需增加 `conversationId: string` |
| `chat:reply` | 主→渲染 | 一次性推送完整回复，payload: `{ siteId: string, result: AutomationResult }` |
| `chat:quota-exhausted` | 主→渲染 | 通知渲染进程该 `siteId` 免费额度已用尽 |
| `chat:switch-model` | 渲染→主 | M11：切换目标账号的 AI 模型，payload: `{ siteId: string, modelId: string }`；成功后写入 `SiteConfig.activeModel` |
| `dialog:open-file` | 渲染→主 | ❌ 未实现（规划中）：触发系统文件选择对话框，返回 `{ paths: string[] }`；用于附件上传前获取本地文件路径（见 §2.8） |
| `calibrate:needed` | 主→渲染 | 通知渲染层需要进入校准模式 |
| `calibrate:start` | 渲染→主 | 开始校准流程 |
| `calibrate:cancel` | 渲染→主 | 取消正在进行的校准流程 |
| `calibrate:done` | 主→渲染 | 校准完成通知 |

> ⚠️ **本表非穷尽**。代码中另有已实现但未列入上表的通道（以 `src/main/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts` 为准）：
>
> - 运行时策略/统计：`site:get-runtime-policy` / `site:set-runtime-policy` / `site:get-runtime-stats` / `site:clear-runtime-stats`、`site:runtime-event`（推送）
> - 网络诊断：`site:get-network-diagnostics` / `site:refresh-network-diagnostics`、`site:get-last-chat-failure` 等诊断通道（§2.0.9）
> - 模型/工具/Effort：`chat:list-models`、`chat:list-tools` / `chat:toggle-tool`（工具开关）、Effort 档位相关通道
> - 校准过程推送：`calibrate:step`
> - 本地 Adapter：`adapter:get-info`（§2.0.8）
> - **Stagent 工作流引擎**：`stagent:*` 命名空间（注册于 `src/main/stagent/stagent-ipc.ts`，UI 为 `StagentPage.tsx`；契约见 `docs/task-lifecycle.md` 与 `docs/STAGENT-PRD-ENGINEER.md`，不在本 SPEC 范围内展开）

---

## 五、后台浏览器模型

### 用户感知的世界 vs 实际发生的事

**用户看到的**：
```
┌─────────────────────────────────────────┐
│  一个干净的聊天界面，顶部可以切换 AI 模型  │
│  选 Claude → 发消息 → 收到回复           │
│  切换 ChatGPT → 发消息 → 收到回复        │
│  整个过程从不离开这个页面                 │
└─────────────────────────────────────────┘
```

**实际发生的**：
```
应用启动
  ↓
后台静默预加载所有已添加的 AI 网站（不显示给用户）
  ├─ WebContentsView(chatgpt.com)  ← 后台浏览器，用户看不见
  ├─ WebContentsView(claude.ai)    ← 后台浏览器，用户看不见
  └─ WebContentsView(gemini.google.com) ← 后台浏览器，用户看不见

用户选择 Claude，发送 "帮我分析这段逻辑的漏洞"
  ↓
主进程把这段文字注入到 claude.ai 的后台 WebContentsView
  ↓
等待 claude.ai 页面生成完毕
  ↓
抓取回复文字
  ↓
回复出现在应用界面 ← 用户只看到这一步
```

### 关键设计原则：用户永远不需要切换到浏览器

- 登录时（首次设置）：显示浏览器窗口让用户操作
- 聊天时（日常使用）：浏览器完全在后台运行，用户只看应用 UI
- 切换 AI：不是切换浏览器标签，是切换后台 WebContentsView 的注入目标

### 多模型并排使用场景

```
用户工作流示例：
  1. 在 autoAI 输入"帮我分析这个论点的逻辑漏洞" → 选 Claude → 发送 → 得到推理分析
  2. 在同一界面输入"收集关于这个话题的5个论据" → 切换到 ChatGPT → 发送 → 得到信息汇总
  3. 两次对话都在同一个应用界面，历史记录并排显示
```

每个 AI 网站有独立的对话历史（在应用 UI 层维护），互不干扰。

---

## 六、核心数据流

### 发送一条消息的完整链路

```
用户在 MessageInput 输入文字，点击发送
    ↓
[渲染进程] chatApi.send(siteId, text)
    ↓  IPC: chat:send
[主进程 ipc.ts] 接收请求
    ↓
[site-store.ts] 查询该 siteId 的 SiteConfig
    ↓  有可用的 `inputSelectors` / `sendSelectors` / `responseSelectors`？
    ├─ 是 → 直接用
    └─ 否 → [detector.ts] 自动识别，找到后存入 site-store
    ↓
[injector.ts] 把文字注入到输入框，点击发送按钮
    ↓  注入成功？
    ├─ 否 → 推送 `calibrate:needed`，渲染进程进入校准引导并调用 `calibrate:start`
    └─ 是 → 继续
    ↓
[response-watcher.ts] 启动 MutationObserver，等待 DOM 稳定
    ↓  超时 or 稳定
[response-watcher.ts] 提取最后一条回复文字
    ↓  IPC: chat:reply
[渲染进程] MessageList 追加 AI 消息
```

### 6.1 最小验收标准（V1）

- Given 已连接站点且 `inputSelectors` / `sendSelectors` / `responseSelectors` 至少各有一个可用策略，When 用户发送非空文本，Then 渲染层立即追加一条本地用户消息、输入框进入 disabled 状态，并在 120 秒内收到 `chat:reply` 或 `chat:quota-exhausted` 二者之一。
- Given 站点缺少可用选择器且自动探测失败，When 用户发送消息，Then 主进程返回 `selectors-not-found`，并在 3 秒内推送 `calibrate:needed`，界面进入校准模式。
- Given 登录页已转入可聊天状态且输入框可见，When 登录检测轮询命中可见输入元素，Then 对应 `siteId` 的状态在下一次推送中变为 `connected`，对应 WebContentsView 自动收起。
- Given 等待回复期间出现 `quotaExhaustedIndicator`，When 并行检测命中该标识，Then 终止正常回复等待、持久化 `quotaExhausted=true`、推送 `chat:quota-exhausted`，且当前账号输入框保持禁用直至用户切换账号或状态清除。

---

## 七、UI 设计

### 7.1 启动决策树

```
启动软件
    ↓
读取 site-store（sites.json）
    │
    ├── 空（无任何记录）→ ResourcesPage 向导模式
    │                       聚焦单一任务：连接第一个 AI
    │                       用户完成至少一个登录后 → 进入 ChatPage
    │
    └── 非空（有记录）→ ChatPage
                          站点切换控件只允许激活 status='connected' 的账号
                          若无 connected 账号 → ChatPage 显示空态提示
```

**判定"有记录"的条件**：`site-store` 中存在至少一条 `SiteConfig`（无论登录状态）。

---

### 7.2 WebContentsView 可见模式

每个 AI 账号对应一个后台 `WebContentsView`，默认移到窗口可视区域外并保持完整渲染尺寸（而非 `0×0`），以避免后台页面的 `requestAnimationFrame` / 定时器 / `MutationObserver` 被节流。  
以下三种情况会让它"升起来"覆盖在应用界面上：

#### 模式一：登录（Login）

**触发**：用户在 ResourcesPage 点击「登录」按钮  
**表现**：WebContentsView bounds = `{x:0, y:40, width:全宽, height:全高-40}`，覆盖顶部栏以下区域，用户看到并操作真实 AI 网站  
**关闭方式**：  
- 自动：主进程 500ms 首检 + 每 1.5 秒轮询 `inputSelector`，元素可见即判定登录成功 → 自动收起，站点切换控件新增该账号，status → `connected`  
- 最长等待 5 分钟超时后停止轮询

```
ResourcesPage 点"登录"
    ↓ site:open-login IPC
WebContentsView 展开（y=40，全高）
    ↓ 用户操作：账号密码 / OAuth / 验证码…
500ms 首检 + 每 1.5s 检查 inputSelector 是否可见
  ├─ 可见 → 登录成功，WebContentsView 收起，status → connected
  └─ 5 min 超时 → 停止轮询，用户手动操作（可再次点登录）
```

#### 模式二：浏览（Browse）

**待确认**：Browse 模式的显式 UI 入口最终放在 Tab Bar 还是 ResourcesPage 菜单；在入口确定前，仅将 `site:show-view` / `site:hide-view` 视为协议保留。  
**触发**：用户通过 Browse 入口在 ChatPage 内直接查看/操作 AI 网页  
**表现**：WebContentsView bounds = `{x:0, y:40, width:全宽, height:全高-40}`，Chat UI 变为 `invisible`（仍在 DOM 中）  
**视觉标识**：站点切换控件中当前正在浏览的账号需要有明确高亮标识  
**关闭方式**：  
- 再次点击同一标签 → `site:hide-view` → WebContentsView 收起，Chat UI 恢复可见  
- 点击 Home 按钮 → 同上

```
触发 Browse 入口
    ↓ site:show-view IPC
WebContentsView 展开（y=40，全高）
Chat UI invisible
    ↓
再次点击同一标签 / 点 Home 按钮
    ↓ site:hide-view IPC
WebContentsView 收起，Chat UI 恢复
```

#### 模式三：校准（Calibration）

**触发**：`chat:send` 失败（`selectors-not-found`），主进程推送 `calibrate:needed`  
**表现**：WebContentsView bounds = `{x:0, y:120, width:全宽, height:全高-120}`，顶部 120px 留给渲染层显示引导条  
**流程**：两步点击 → 捕获输入框和回复区的 CSS 选择器 → 写入 site-store → `calibrate:done`  
**关闭方式**：两步完成自动关闭，或用户点「取消」

```
发送消息 → selectors-not-found
    ↓ calibrate:needed 推送
渲染层显示 CalibrationOverlay（顶部引导条）
WebContentsView 展开（y=120，保留顶部引导条）
    ↓
步骤 1：请点击输入消息的地方 → 捕获 inputSelector
步骤 2：请点击一条 AI 的回复 → 捕获 responseSelector
    ↓
写入 site-store（calibrated=true），WebContentsView 收起
calibrate:done → 渲染层关闭 CalibrationOverlay
```

---

### 7.3 AI 资源设置页（ResourcesPage）

两种模式入口不同，核心 UI 相同：

| 模式 | 入口 | 用途 |
|---|---|---|
| A — 新用户向导 | 首次启动（site-store 为空） | 连接第一个 AI，完成后跳 ChatPage |
| B — 管理中心 | ChatPage `···` 菜单 → 「管理 AI 资源」 | 增删账号、重新登录、调试选择器 |

#### 模式 A：选择 AI 向导

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              选择你的 AI 助手                        │
│          登录后即可在 autoAI 中统一调用               │
│                                                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│   │ ChatGPT  │  │  Claude  │  │  Gemini  │         │
│   └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│   │ DeepSeek │  │   Kimi   │  │   其他   │         │
│   └──────────┘  └──────────┘  └──────────┘         │
│                                                     │
│                                         [跳过]      │
└─────────────────────────────────────────────────────┘
```

- 点击任意卡片 → `site:add` 创建记录 + 立即触发登录流程（WebContentsView 展开）
- 「其他」→ 弹出 URL 输入对话框
- 「跳过」→ 进入 ChatPage（ChatPage 会显示空态提示）

#### 模式 B：管理中心

```
┌─────────────────────────────────────────────────────┐
│                            [+ 添加]  [开始对话]      │
│  AI 资源管理                                         │
├─────────────────────────────────────────────────────┤
│  ChatGPT 工作        chatgpt.com  已连接      ···   │
│  ChatGPT 个人        chatgpt.com  未登录  [登录]     │
│  Claude              claude.ai    已连接      ···   │
│  DeepSeek            deepseek.com 额度用尽 [检查]    │
│  ─────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────┘
```

- 状态用**文字**而非颜色：「已连接」「未登录」「额度用尽」「登录中…」
- `···` 展开菜单：重新登录 / 重命名 / 调试选择器 / 删除
- 同一 hostname 可出现多行（M10 多账号）
- `[+ 添加]` 输入任意 URL，不去重，每次都创建新账号记录

**不可用状态的操作路径**：

| 状态 | 行为按钮 | 动作 |
|---|---|---|
| 未登录 | 登录 | WebContentsView 展开（登录模式），自动检测成功后收起 |
| 额度用尽 | 检查 | 后台静默探测 `quotaExhaustedIndicator`；消失则 status → connected，否则行内提示"暂未重置，通常次日自动恢复" |

---

### 7.4 ChatPage 顶部工具栏（当前 V1）

```
┌──[●][●][●]──────────────── drag 区域 ─────────────────────────[⚙]──┐
│  [Claude ▼]   [···]                                                  │
```

Title bar（高 40px）：纯 `drag-region`，右侧设置按钮（`⚙`）跳转 ResourcesPage。  
ChatPage 内部顶部工具栏（独立 `div`，非 title bar）：

| 元素 | 说明 |
|---|---|
| 站点切换控件（当前为 Tab Bar，M9 已完成） | 选择当前活跃 AI；只显示 `status='connected'` 的站点 |
| `···` 菜单 | 新建对话 / 管理 AI 资源 |

**ModelDropdown 选项结构**：

| 选项类型 | 显示方式 | 可选 |
|---|---|---|
| 已连接账号（`status='connected'`） | 正常文字，显示 label | ✅ |
| 额度用尽账号（`status='quota-exhausted'`） | 灰色文字 + "额度用尽" 标注 | ❌ |
| 分隔线 | — | — |
| 「管理 AI 资源…」 | 灰色文字，功能入口 | — |

**额度耗尽通知策略（不自动切换）**：  
收到 `chat:quota-exhausted` 事件后，ChatPage **不自动切换** `activeSiteId`。原因：自动切换会无声地打断多轮对话的上下文——新账号是完全独立的 AI session，对之前的对话内容毫不知情。

实际行为：
1. 刷新 `sites` 列表，使耗尽账号的 `status` 更新为 `'quota-exhausted'`
2. 在当前对话中追加系统消息：
   - 有其他可用账号时：「今日额度已用尽，请从上方标签栏切换其他账号继续对话」
   - 全部耗尽时：「所有账号额度已用尽，请明天再试或在设置中添加新账号」
3. 输入框自动 `disabled`（`activeSite.status === 'quota-exhausted'`），placeholder 显示「当前账号额度已用尽，请从上方切换其他账号」
4. 用户**主动**从 Tab Bar 切换账号，切换后在新账号的对话中重新开始

> **预留**：额度耗尽后自动切换账号的辅助函数（遍历账号列表、选择首个 `status=connected` 账号）保留为内部工具函数，供未来工作流自动化（批量任务队列、并发调度等）复用，不在 Chat UI 的 `chat:quota-exhausted` 响应中启用。

---

### 7.5 首页（ChatPage）完整状态

ChatPage 由 App.tsx 的路由控制何时出现，自身内部有以下五种状态：

> 下列示意图只表达状态，不强制站点切换控件必须为 Tab Bar；V1 当前实现可使用 `ModelDropdown`，M9 目标形态再替换为 Tab Bar。

#### 状态 A：无已连接 AI（空态）

```
┌── Tab Bar（无标签，只有 Home / + / 设置）──────────────────────┐
│                                                               │
│                                                               │
│                    还没有可用的 AI                             │
│                                                               │
│                    连接一个 AI →                               │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- 进入条件：`sites.filter(s => s.status === 'connected').length === 0`
- 无输入框，无消息列表
- 点「连接一个 AI →」→ 跳转 ResourcesPage

#### 状态 B：正常聊天

```
┌──[●][●][●]────────────── drag ─────────────────────────[⚙]───┐
│  [Claude ▼]                                           [···]   │
│                                                               │
│   用户 14:01                                                   │
│   帮我改进这段代码                                              │
│                                                               │
│           AI 14:01                                            │
│           好的，以下是优化后的版本…                             │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  给 Claude 发消息…                                    [发送]   │
└───────────────────────────────────────────────────────────────┘
```

- 消息列表按 `message.siteId === activeSiteId` 过滤，切换下拉框即切换对话视图
- 输入框 placeholder = `给 ${activeSite.label} 发消息…`
- 每个账号的消息历史在本次运行期间独立保存（重启清空）

#### 状态 C：生成中

- 输入框 `disabled`，发送按钮不可点
- 底部显示 `${activeSite.label} 正在生成…`（pulse 动画）
- 全局唯一：任一账号生成中，所有账号输入均锁定（`isBusy` 保护）

#### 状态 D：浏览模式覆盖

- ChatPage 整体 CSS `invisible`（不可见但仍占位，保持布局）
- WebContentsView 覆盖其上（title bar 以下区域，y=40）
- title bar 仍可见（含设置按钮）
- 此时不能发送消息（Chat UI 不可见）
- 浏览模式由 Browse 入口触发；具体入口见 §7.2 的待确认项，ChatPage 不负责定义入口位置

#### 状态 E：校准中

- `CalibrationOverlay` 覆盖在 ChatPage 最上层（`absolute` 全覆盖）
- 显示步骤指示（"请点击输入消息的地方" / "请点击一条 AI 的回复"）
- WebContentsView 在 y=120 位置展开（顶部留出 CalibrationOverlay 的操作区）
- 点「取消」→ `calibrate:cancel` IPC → WebContentsView 收起，Overlay 消失

---

### 7.6 多账号聊天使用方式（M10）

M10 后，相同 AI 网站的多个账号在下拉框中并列显示，操作方式如下：

**添加第二个账号**：
1. ResourcesPage → `[+ 添加]` → 输入相同 URL（如 `https://chatgpt.com`）
2. 创建新的 `siteId`（UUID），独立 session，下拉框出现新选项
3. 展开 WebContentsView，用新账号完成登录

**切换账号发消息**：
```
下拉框：[ChatGPT 工作 ▼]  ←→  [ChatGPT 个人]
              ↑ 选择切换 activeSiteId
            发送 → 注入到对应账号的 WebContentsView
            回复 → 按 siteId 追加到该账号的消息记录
```

**额度耗尽通知（不自动切换）**：
- 当前账号额度用尽 → 对话中追加提示消息，输入框 disabled，**不切换** `activeSiteId`
- 用户主动从 Tab Bar 切换其他账号后继续（上下文由用户决定是否补充）
- 全部耗尽 → 追加「所有账号额度已用尽」提示，Tab Bar 无可选标签

**消息隔离**：
- 每个账号有独立的消息列表（按 `siteId` 过滤）
- 切换下拉框 → 立即切换到该账号的对话历史
- 两个账号之间互不干扰，各自的 session（cookie jar）完全隔离

**账号标签命名**：
- 默认 label = `SiteConfig.label`（来自 preset 或 hostname）
- 可从 ResourcesPage 的 `···` 菜单重命名（如"ChatGPT 工作" / "ChatGPT 个人"）

---

### 7.7 状态汇总

| 场景 | WebContentsView | Chat UI | 输入框 |
|---|---|---|---|
| 正常聊天（无生成） | 窗口外全尺寸后台运行 | 可见 | enabled |
| 正在生成 | 窗口外全尺寸后台运行 | 可见 | disabled |
| 登录中 | 展开（y=40） | 被覆盖 | — |
| 浏览中（Browse 模式） | 展开（y=40） | invisible | — |
| 校准中 | 展开（y=120） | CalibrationOverlay 覆盖 | — |

| 事件 | 推送方向 | ChatPage 响应 |
|---|---|---|
| `site:status-changed` | 主→渲染 | `loadSites()`，站点切换控件刷新 |
| `site:login-success` | 主→渲染 | `loadSites()`，站点切换控件新增选项 |
| `chat:reply` | 主→渲染 | 追加 AI 消息，`isGenerating=false` |
| `chat:quota-exhausted` | 主→渲染 | 追加系统提示，`loadSites()` |
| `calibrate:needed` | 主→渲染 | 打开 CalibrationOverlay |
| `calibrate:done` | 主→渲染 | 关闭 CalibrationOverlay，`loadSites()` |

---

### 7.8 对话管理（多 Chat 与历史记忆）

#### AI 记忆从哪里来？

autoAI 的后台 WebContentsView **就是一个真实的浏览器**，运行着真正的 ChatGPT/Claude 网页。因此：

- **AI 的记忆 = AI 网站自身的对话上下文**（由 AI 服务商的服务器维护）
- 向同一个 WebContentsView 持续发送消息 → AI 网站自然积累对话历史 → AI 记住上下文
- 这与直接在浏览器里使用 ChatGPT **完全一致**，无需 autoAI 做任何额外处理

autoAI 维护的本地 `messages` 数组仅是**渲染层 UI 的镜像**，不影响 AI 的实际记忆。

#### V1 设计：单线程对话模式（当前实现）

每个 AI 账号（`siteId`）对应一个 WebContentsView，维护一条持续积累的对话线程：

```
首次登录 → AI 网站在后台加载（继续上次的对话或空页面）
    ↓
用户发消息 A → AI 回复 A（AI 记住 A）
用户发消息 B → AI 回复 B（AI 记住 A + B）
用户发消息 C → AI 回复 C（AI 记住 A + B + C）
    ↓
对话历史积累在 AI 网站的服务器上，只要 session 不清除就持续存在
```

**限制**：
- 应用重启后，**UI 的本地消息列表清空**（见 §8 第5条），但 AI 网站上的对话上下文仍在
- 无法在 autoAI 中切换到过去的对话（不能浏览历史）
- 所有消息累积在同一条线程，不同主题互相干扰

**`···` 菜单「新建对话」（V1 行为）**：在后台 WebContentsView 中导航到 AI 网站首页（等效于在 ChatGPT 中点 "New chat"），开启全新上下文；本地消息列表清空。

#### V2 计划：多 Chat 对话管理（M12，未实现）

**目标**：像 ChatGPT/Claude 客户端一样，在 autoAI 中创建和切换多个独立的对话。

**核心技术**：每条 Conversation 对应 AI 网站上的一个真实 chat thread（有独立的 URL）。切换对话 = 在后台 WebContentsView 中导航到对应的 chat URL。

```
用户点击「新建对话」
    ↓
主进程：在对应 WebContentsView 中点击「New Chat」按钮（或导航到网站首页）
    ↓
AI 网站创建新的 chat thread，URL 变为 chatgpt.com/c/abc123
主进程记录该 chatUrl，本地创建新的 Conversation 记录
    ↓
用户在新对话中发消息（全新 AI 上下文，与之前完全隔离）
```

**V2 新增数据结构**：

```typescript
interface Conversation {
  id: string          // UUID
  siteId: string      // 归属账号
  chatUrl?: string    // AI 网站上的 chat thread URL（用于导航恢复）
  title: string       // 对话标题（取第一条用户消息前 20 字）
  createdAt: number
  messages: Message[] // 本地消息镜像（V2 持久化到 conversations.json）
}
```

**导航到历史对话**：点击侧边栏某条历史对话 → 主进程执行 `webContentsView.loadURL(conversation.chatUrl)` → 等待 inputSelector 可见 → AI 上下文恢复（chat thread 仍在 AI 服务器上）。

**V1 → V2 迁移**：V1 用户只有一个隐式对话，升级后标记为 `title = '默认对话'`，消息列表无缝迁移不丢失。

#### 小结

| | V1（当前） | V2（M12） |
|---|---|---|
| AI 的上下文记忆 | ✅ 真实（真实浏览器 session） | ✅ 真实（同上） |
| 多 Chat 切换 | ❌ 单线程 | ✅ 多对话列表 |
| 历史记录持久化 | ❌ 重启丢失 | ✅ 存 conversations.json |
| 开启新话题 | ✅ `···` 菜单「新建对话」（跳首页） | ✅ 侧边栏「+」新建 |

---

## 八、明确不做的事（硬边界）

以下功能即使用户提出，也不在本项目范围内：

1. **API Key 接入** — 不支持 Gemini/OpenAI/DeepSeek 等付费 API
2. **费用追踪** — 浏览器模式本身免费，无需追踪
3. **视频合成/剪辑** — autoAI 只负责"拿到输出 URL"，视频合成是上层业务
4. **插件系统** — 不允许第三方扩展
5. **消息历史持久化与多对话管理** — V1 不持久化聊天记录，不支持多 Chat 切换（详见 §7.8；V2 计划在 M12 实现）
6. **自动更新** — 第一版不做（可后续通过 electron-updater 添加）
7. **Windows/Linux 支持** — 仅 macOS

> 边界澄清：`§2.0.8` 的本地 Adapter 是“对本地网页自动化能力的协议兼容层”，**不是**对官方付费 API 的接入，也不管理第三方平台计费。

**预留扩展点（接口已定义，实现留给未来）**：
- `outputType: 'video'` 的完整提取逻辑
- 图片批量下载到本地（目前只返回 URL）
- 工作流编排（将多个 AI 原子操作串联为自动化流水线）— autoAI 提供原子能力，编排在外部

---

## 九、技术栈

| 层 | 技术 | 理由 |
|---|---|---|
| 桌面框架 | Electron ^30 | 唯一能做 WebContentsView 浏览器自动化的桌面框架 |
| UI | React 18 + TypeScript | 组件化，类型安全 |
| 构建 | electron-vite | 专为 Electron 优化的 Vite 方案，热更新 |
| 样式 | Tailwind CSS 3 | 快速，无需自定义 CSS |
| 持久化 | JSON 文件（fs） | site-store 数据量小，无需 SQLite |
| 日志 | electron-log | 文件日志，调试自动化脚本时必须有 |

**主窗口默认尺寸**：宽 1000px，高 700px，最小宽度 800px，最小高度 560px。登录 / 浏览 / 校准态的 WebContentsView 覆盖 title bar 以下的内容区域。

---

## 十、实现顺序（里程碑）

### 10.0 最近变更登记（Changelog，必填）

> 目的：确保“先改 SPEC，再改代码”可执行，避免功能落地后文档遗漏。  
> 规则：**任何会影响行为、接口、脚本、验收或运维方式的改动，都必须先在此登记。**

#### 10.0.1 固定登记模板（复制即用）

```md
#### [YYYY-MM-DD] 标题（简短）
- 变更类型：feature | fix | refactor | docs | test | ops
- 影响范围：main | preload | renderer | scripts | ci | docs
- 关联章节：§x.x、§十 Mx（可多项）
- 变更摘要：
  - ...
  - ...
- 新增/变更接口（如有）：
  - IPC: ...
  - HTTP: ...
  - ENV: ...
- 验收与回归：
  - 命令：...
  - 结果：pass/fail
- 兼容性与回滚：
  - ...
```

#### 10.0.2 登记触发条件（满足任一即登记）

- 新增/修改 IPC、HTTP 接口、环境变量、脚本命令。
- 变更自动化主链路（注入、拦截、回退、超时、修复策略）。
- 变更失败码、快照结构、门禁阈值或 CI 判定逻辑。
- 变更用户操作路径（Resources/Chat/登录/校准/状态面板）。
- 变更里程碑任务状态（从 pending 到完成）。

#### 10.0.3 最近已登记变更（当前基线）

#### [2026-05-07] 本地 Adapter（OpenAI 兼容最小接口）接入
- 变更类型：feature
- 影响范围：main | preload | renderer | docs
- 关联章节：§2.0.8、§十 M11+（运维与对接能力）
- 变更摘要：
  - 新增本地 Adapter 服务，提供 `/health`、`/v1/models`、`/v1/chat/completions`（当前 `stream=false`）。
  - 新增 `sendSeq` settled 事件总线，Adapter 端可等待本轮发送结果再返回。
  - Resources 稳定性面板新增 Adapter 信息展示（启用状态与 URL）。
- 新增/变更接口：
  - IPC: `adapter:get-info`
  - HTTP: `GET /health`、`GET /v1/models`、`POST /v1/chat/completions`
  - ENV: `AUTOAI_ADAPTER_ENABLE`、`AUTOAI_ADAPTER_HOST`、`AUTOAI_ADAPTER_PORT`
- 验收与回归：
  - 命令：`npm run typecheck`、`node scripts/run-regression-loop.js`
  - 结果：pass
- 兼容性与回滚：
  - 设置 `AUTOAI_ADAPTER_ENABLE=0` 可关闭 Adapter，核心网页自动化链路不受影响。

#### [2026-05-07] 失败快照升级为结构化事件流 + 门禁
- 变更类型：feature
- 影响范围：main | scripts | ci | docs
- 关联章节：§2.0.9、§1.2.4（回归保护）
- 变更摘要：
  - `failure-snapshot` 升级为结构化 JSON（含 events/summary/gate）。
  - 新增 NDJSON 事件流导出，便于日志平台与统计系统消费。
  - 回归脚本串联门禁检查，失败时以非 0 退出码阻断流水线。
- 新增/变更接口：
  - ENV: `AUTOAI_CI_MAX_FAILURES`、`AUTOAI_CI_MAX_UNKNOWN`
  - Scripts: `extract-failure-snapshot.js`、`check-adapter-gates.js`、`run-regression-loop.js`
- 验收与回归：
  - 命令：`npm run regression:loop`
  - 结果：pass
- 兼容性与回滚：
  - 可通过调整门禁阈值临时放宽策略；保留原日志文件用于手工排查。

### M1：能跑起来（骨架）✅
- [x] package.json + tsconfig + electron-vite 配置
- [x] 创建主窗口，渲染进程显示 "Hello autoAI"
- [x] 基本 IPC 通信验证（ping/pong）

**开发启动命令**（在仓库根目录，即当前 `autoAI/` 目录）：
```bash
npm run dev
```
> 如需直接调用二进制，可使用 `node_modules/.bin/electron-vite dev`。

### M2：能打开网站（连接）✅
- [x] `session.ts` — 持久化 Session
- [x] `browser-view.ts` — 在应用内显示 WebContentsView
- [x] `site:add` / `site:open-login` IPC
- [x] ResourcesPage 显示网站列表 + 登录按钮

### M3：能发消息（注入）✅
- [x] `detector.ts` — 输入框自动识别
- [x] `injector.ts` — 文字注入 + 发送
- [x] ChatPage 基础 UI
- [x] `chat:send` IPC

### M4：能收回复（检测）✅
- [x] `response-watcher.ts` — MutationObserver + 稳定检测
- [x] `chat:reply` IPC 推送
- [x] MessageList 显示 AI 回复

### M5：处理失败（校准 + Selector Debugger）✅
- [x] `CalibrationOverlay.tsx` — 引导用户点击输入框和回复区域（两步流程）
- [x] `site-store.ts` 保存校准结果
- [x] `calibrate:start` / `calibrate:done` IPC
- [x] `SelectorDebugger.tsx` — 5 个字段直接编辑，支持保存和「重新校准」入口
- [x] `site:update-selectors` IPC
- [x] 额度耗尽检测（`quotaExhaustedIndicator` 并行轮询）
- [x] `chat:quota-exhausted` IPC + SiteCard 🟠 额度用尽状态

### M6：体验打磨 ✅
- [x] 连接状态实时更新（`site:status-changed` 推送 + 渲染端监听）
- [x] 登录状态检测（启动时 `probeAllSites` 后台探测，5s 后执行）
- [x] 额度用尽持久化（`quotaExhausted` 写入 sites.json）
- [x] ResourcesPage 内联动作按钮（"登录" / "检查"）
- [x] 当当前 `activeSiteId` 无效时默认选中首个可用 AI（`chat:quota-exhausted` 场景除外）

### M7：内置预设选择器 ✅

**目标**：新用户添加主流 AI 网站后，无需手动校准即可直接使用。

**设计原则**：
- 预设选择器以 `priority: 5` 写入 `site-store`（低于用户手动校准的 10，高于自动探测的 3）
- 仅在网站**首次添加**时注入（`calibrated: false` 且选择器链为空时）
- 预设数据独立维护在 `src/main/presets.ts`，格式与 `SiteConfig` 选择器字段一致
- 支持扩展：新增网站只需在 `presets.ts` 追加条目

**首批支持的网站**：

| 网站 | hostname | 输入框 | 发送按钮 | 回复容器 | quotaExhaustedIndicator |
|---|---|---|---|---|---|
| ChatGPT | chatgpt.com | `#prompt-textarea` | `button[data-testid="send-button"]` | `article[data-testid^="conversation-turn"]` | `text=You've reached your free limit` |
| Claude | claude.ai | `div[contenteditable="true"].ProseMirror` | `button[aria-label="Send Message"]` | `div.font-claude-message` | `text=You've hit your free plan limit` |
| Gemini | gemini.google.com | `rich-textarea .ql-editor` | `button.send-button` | `message-content` | `text=You're out of free Gemini` |
| DeepSeek | chat.deepseek.com | `#chat-input` | `button[aria-label="Send"]` | `div.ds-markdown` | `text=Your account has reached the free usage limit` |
| Kimi | kimi.moonshot.cn | `div[contenteditable="true"]` | `button[aria-label="发送"]` | `div.markdown-body` | `text=今日免费额度` |

**实现文件**：

```
src/main/presets.ts          ← 新建：预设数据表
```

**`presets.ts` 数据结构**：

```typescript
import type { SelectorChain } from './site-store'

export interface SitePreset {
  hostname: string
  inputSelectors: SelectorChain
  sendSelectors: SelectorChain
  responseSelectors: SelectorChain
  quotaExhaustedIndicator?: string
  fileUploadTrigger?: string      // M11：附件按钮选择器（见 §2.8）
  availableModels?: ModelOption[] // M11：可用模型列表（见 §2.9）
  modelSwitcherSelector?: string  // M11：模型切换按钮选择器（见 §2.9）
  chatUrlPattern?: RegExp         // M12：chat thread URL 匹配正则（见 §10 M12）
}

export const PRESETS: SitePreset[] = [ /* ... */ ]

/** 根据 hostname 查找预设，找不到返回 undefined */
export function findPreset(hostname: string): SitePreset | undefined {
  return PRESETS.find((p) => p.hostname === hostname)
}
```

**注入时机**：在 `site-store.ts` 的 `add()` 方法末尾，调用 `findPreset(hostname)`，有预设则合并到选择器链（仅当链为空时写入，不覆盖已有数据）。

**任务清单**：
- [x] 新建 `src/main/presets.ts`，填入上表 5 个网站的选择器数据
- [x] `site-store.ts` 的 `add()` 方法在写入后调用 `findPreset`，有预设则合并到选择器链（含 `quotaExhaustedIndicator`）
- [x] ResourcesPage 的 `PRESET_CATALOG` 中的 hostname 与 `presets.ts` 保持一致
- [ ] 手动验证：在 ChatGPT / Claude / Gemini 各发一条消息，确认无需校准即可收到回复

### M8：单元测试 ✅

**目标**：为三个核心主进程模块补充自动化测试，改代码后秒级确认没有引入回归。

**测试框架**：`vitest`（已在 monorepo 中使用，风格与 Jest 一致，支持 TypeScript）。

**测试文件位置**：与被测文件同目录，后缀 `.test.ts`。

```
src/main/site-store.test.ts
src/main/injector.test.ts
src/main/response-watcher.test.ts
```

**运行命令**（在仓库根目录）：
```bash
npm test
```

---

#### M8.1 `site-store.test.ts`

被测文件：`src/main/site-store.ts`

| 测试用例 | 验证什么 |
|---|---|
| `add()` 正常添加网站 | 调用后 `list()` 包含新返回的 `siteId`，且记录中的 `hostname` 正确 |
| `add()` 重复添加同一网站 | 第二次调用不报错，并返回新的 `siteId`（允许同 `hostname` 多条记录） |
| `add()` URL 解析失败 | 抛出可识别的错误（不是崩溃） |
| `remove()` 存在的网站 | 调用后 `list()` 不包含该 `siteId` |
| `remove()` 不存在的网站 | 静默忽略，不报错 |
| `updateSelectors()` source='detector'，`calibrated=false` | 选择器被写入 |
| `updateSelectors()` source='detector'，`calibrated=true` | 选择器**不被覆盖**（保护已校准数据） |
| `updateSelectors()` source='user' | 无论 `calibrated` 状态，选择器被写入，`calibrated` 置为 `true` |
| `setQuotaExhausted(true)` | `get()` 返回的 config 中 `quotaExhausted === true` |
| `setQuotaExhausted(false)` | `get()` 返回的 config 中 `quotaExhausted` 为 `undefined` 或 `false` |
| 持久化：写入后重新构造实例 | 数据从文件中正确读回 |

**隔离策略**：每个测试用例使用 `os.tmpdir()` 下的临时目录，测试结束后删除。

---

#### M8.2 `injector.test.ts`

被测文件：`src/main/injector.ts`

`inject()` 的核心逻辑是生成注入脚本字符串并在 WebContents 中执行。测试策略：**直接测试脚本生成逻辑**，不依赖真实 Electron 环境。

| 测试用例 | 验证什么 |
|---|---|
| 生成的脚本包含正确的选择器 | 脚本字符串中含有传入的 `inputSelector` |
| 生成的脚本包含正确的文本内容 | 脚本字符串中含有 `JSON.stringify(text)` 编码后的文本 |
| 文本含特殊字符（引号、反斜杠、换行） | 生成的脚本仍是合法 JS（可被 `new Function` 解析而不抛出） |
| 选择器链为空时 | `inject()` 返回 `{ ok: false, reason: 'no selectors' }` |
| mock WebContents 执行脚本返回成功 | `inject()` 返回 `{ ok: true }` |
| mock WebContents 执行脚本抛出异常 | `inject()` 返回 `{ ok: false, reason: 'error message' }` |

**Mock 方式**：用 `vi.fn()` 模拟 `WebContentsView.webContents.executeJavaScript`，避免启动真实 Electron。

---

#### M8.3 `response-watcher.test.ts`

被测文件：`src/main/response-watcher.ts`

`watchForReply()` 注入 MutationObserver 脚本并轮询执行结果。测试策略：**测试脚本语法合法性 + mock executeJavaScript 返回序列**。

| 测试用例 | 验证什么 |
|---|---|
| 注入脚本语法合法 | `new Function(script)` 不抛出 SyntaxError |
| 正常回复（文字） | mock 返回 `{ done: true, text: 'hello' }` → resolve `{ text: 'hello' }` |
| 额度耗尽 | mock 返回 `{ quotaExhausted: true }` → resolve `{ quotaExhausted: true }` |
| 超时 | mock 始终返回 `{ done: false }` → 超时后 resolve `{ timedOut: true }` |

**超时测试**：使用 `vi.useFakeTimers()` 快进时钟，避免测试实际等待 120 秒。

---

**M7 / M8 完成标准**：
- [ ] M7：5 个主流网站各通过一次完整发送/接收手动测试
- [x] M8：`npx vitest run` 全部通过（28 tests, 3 files, 0 failed）

---

### M9：Tab Bar（macOS 标题栏标签页）

**目标**：在 macOS 交通灯按钮右侧展示并列的 AI 标签页，取代原来的 AI 下拉菜单；打开登录窗口时显示在标签栏下方而非覆盖全屏。

**UI 布局**（高度 40px，与现有 `TITLEBAR_H = 40` 一致）：
```
┌──[●][●][●]── [ChatGPT ×] [Claude ×] [Gemini ×] [+] ──── drag area ──┐
```
- `titleBarStyle: 'hiddenInset'` + `trafficLightPosition: { x: 16, y: 16 }` 已配置
- 标签区左侧留 80px 供交通灯（`w-20`）
- 背景整行 `drag-region`，标签按钮和 + 按钮 `no-drag`
- 只显示 `status === 'connected'` 的站点
- 点击标签 → 切换 `activeSiteId`；`×` → `site:remove` 后刷新列表（已确认：`×` 触发完整删除——账号记录及 session 均清除；如需临时隐藏而不删除，可从 `···` 菜单「重新登录」重置状态）
- `+` → `navigate.go('/resources')`

**状态提升（App.tsx）**：
- `sites: SiteWithStatus[]` 和 `activeSiteId: string | null` 提升至 App.tsx（M10 已完成后端迁移，渲染层直接使用 `activeSiteId`）
- App.tsx 监听 `site:status-changed` → `loadSites()`，刷新两个状态
- `ChatPage` 接收 `activeSiteId` 和 `onActiveSiteIdChange` 为 props（去掉内部 activeSiteId state）
- `ChatPage` 保留自己的 `sites` state（用于标签、空状态判断；独立调用 `site:list`）

**ChatPage 变更**：
- 移除 `<div className="drag-region h-10 shrink-0" />`（由 TabBar 替代）
- 移除 `ModelDropdown` 及其容器（Tab Bar 已承担 AI 切换职责）
- 保留 `MoreMenu`（新建对话 / 管理 AI 资源）于顶部工具栏

**任务清单**：

> **注（M10 后端迁移已完成）**：下列渲染层任务直接使用 `activeSiteId` / `onActiveSiteIdChange`，跳过 `activeHostname` 中间状态；与 M10 任务清单末项"渲染层 `activeHostname → activeSiteId`"合并完成。

- [x] 新建 `src/renderer/src/components/TabBar.tsx`
- [x] `App.tsx`：提升 `sites`/`activeSiteId` 状态，渲染 `<TabBar>`，传 props 给 `<ChatPage>`
- [x] `ChatPage.tsx`：接收 `activeSiteId`/`onActiveSiteIdChange` props，移除拖动区和 ModelDropdown

---

### M10：多账号支持（同一网站多个账号）

**目标**：允许用户为同一 AI 网站（如 ChatGPT）添加多个账号，每个账号拥有完全隔离的浏览器 session、独立的 WebContentsView、独立的 Tab。

---

#### 核心变更：用 `siteId`（UUID）替代 `hostname` 作为唯一键

| 层级 | 改动前 | 改动后 |
|---|---|---|
| `site-store.ts` | `Map<hostname, SiteConfig>` — 同 hostname 只能有一条 | `Map<siteId, SiteConfig>` — siteId 由 UUID 生成，hostname 降为普通字段 |
| `session.ts` | `persist:autoai-{hostname}` — 两个 ChatGPT 账号共享 cookie | `persist:autoai-{siteId}` — 每条记录独立 session |
| `browser-view.ts` | `Map<hostname, ManagedView>` | `Map<siteId, ManagedView>` |
| `ipc.ts` | 所有处理器参数为 `hostname` | 所有处理器参数改为 `siteId` |
| `preload/index.d.ts` | API 方法接受 `hostname` | API 方法接受 `siteId` |

**`SiteConfig` 数据结构变更**：

```typescript
interface SiteConfig {
  siteId: string      // ← 新增，crypto.randomUUID()，唯一键
  hostname: string    // chatgpt.com（可重复，仅用于 session 隔离命名参考）
  label: string       // 用户可自定义，如"ChatGPT 工作"/"ChatGPT 个人"
  url: string
  // ...其余字段不变
}
```

**`add()` 行为变更**：

```typescript
// 改动前：同 hostname 第二次调用直接返回已有项
if (this.data.has(hostname)) return this.data.get(hostname)!

// 改动后：每次调用始终创建新记录（siteId 不同 = 独立账号）
const siteId = crypto.randomUUID()
const config = { siteId, hostname, label: label ?? preset?.label ?? hostname, ... }
this.data.set(siteId, config)
```

> **注意**：去掉重复检测意味着用户可以多次添加同一 URL，每次都是一个独立账号。UI 层负责在重复时询问用户是否创建新账号还是复用已有账号（M10 UI 细节）。

**`session.ts` 变更**：

```typescript
// 改动前
export function getSession(hostname: string): Session {
  return session.fromPartition(`persist:autoai-${hostname}`)
}

// 改动后：用 siteId 做分区 key，两个 ChatGPT 账号得到完全隔离的 cookie jar
export function getSession(siteId: string): Session {
  return session.fromPartition(`persist:autoai-${siteId}`)
}
export async function clearSession(siteId: string): Promise<void> { ... }
```

**持久化文件格式**：`sites.json` 从 `hostname` 键改为 `siteId` 键，结构变化如下：

```json
// 改动前（单账号，按 hostname 去重）
[{ "hostname": "chatgpt.com", "label": "ChatGPT", ... }]

// 改动后（多账号，siteId 保证唯一）
[
  { "siteId": "uuid-A", "hostname": "chatgpt.com", "label": "ChatGPT 工作", ... },
  { "siteId": "uuid-B", "hostname": "chatgpt.com", "label": "ChatGPT 个人", ... }
]
```

**向后兼容**：旧 `sites.json` 中没有 `siteId` 字段的条目，在 `load()` 时自动补充 `siteId = crypto.randomUUID()`，保证升级后旧数据不丢失。

---

#### UI 变更（Tab Bar / ResourcesPage）

- Tab 的 `key` 改为 `siteId`（不再用 `hostname`）
- `activeHostname` 状态改名为 `activeSiteId: string | null`
- `browseHostname` 改名为 `browseSiteId: string | null`
- 添加新 AI 时，若检测到已有相同 hostname，弹出确认：
  ```
  你已经有一个 ChatGPT 账号，是否添加第二个账号？
  [添加新账号]  [取消]
  ```
- Tab 标签显示 `label`，允许用户从 `···` 菜单重命名（写入 `SiteConfig.label`）

---

#### IPC 通道变更汇总

所有以下 IPC 通道的 `hostname` 参数替换为 `siteId`：

| 通道 | 参数变化 |
|---|---|
| `site:remove` | `hostname` → `siteId` |
| `site:open-login` | `hostname` → `siteId` |
| `site:close-login` | `hostname` → `siteId` |
| `site:update-selectors` | `hostname` → `siteId` |
| `site:show-view` | `hostname` → `siteId` |
| `site:hide-view` | `hostname` → `siteId` |
| `chat:send` | `hostname` → `siteId` |
| `chat:reply` payload | `hostname` → `siteId` |
| `chat:quota-exhausted` payload | `hostname` → `siteId` |
| `site:login-success` payload | `hostname` → `siteId` |
| `site:status-changed` payload | `hostname` → `siteId` |
| `calibrate:needed` payload | `hostname` → `siteId` |

`site:add` 不变，仍接受 `url: string`，返回的 `SiteConfig` 中包含新生成的 `siteId`。

---

#### 任务清单

- [x] 更新 `SPEC.md`（本节）
- [x] `site-store.ts`：`SiteConfig` 增加 `siteId`；`add()` 每次生成 UUID；`get/has/remove/updateSelectors/setQuotaExhausted` 改用 `siteId` 为 key；`load()` 向后兼容旧数据
- [x] `session.ts`：`getSession(siteId)` / `clearSession(siteId)` 改用 siteId 分区
- [x] `browser-view.ts`：`Map<siteId, ManagedView>`；`ensure/get/showLogin/hideLogin/showBrowse/hideBrowse/startLoginPoll` 参数改为 `siteId`
- [x] `ipc.ts`：所有处理器参数和 push 事件 payload 改用 `siteId`
- [x] `preload/index.d.ts` + `preload/index.ts`：API 类型和实现更新
- [x] `site-store.test.ts`：测试用例适配 siteId，验证 add() 可创建同 hostname 多条记录
- [x] `TabBar.tsx` / `App.tsx` / `ChatPage.tsx`：`activeHostname` → `activeSiteId`，Tab key 改用 `siteId`（渲染层）

---

### M11：文件上传 + 模型切换（§2.8 / §2.9 实现）

**目标**：在 ChatPage 中支持向 AI 上传本地文件，并在同一账号内切换 AI 模型（如 GPT-4o → o1）。

**文件上传任务清单**：
- [ ] `ipc.ts`：注册 `dialog:open-file` 处理器（`dialog.showOpenDialog`，返回路径数组）
- [ ] `preload/index.d.ts` + `preload/index.ts`：暴露 `dialog.openFile(): Promise<string[]>`
- [ ] `injector.ts`：新增 `injectFiles(view, filePaths, fileUploadTrigger)` 函数（Debugger Protocol）
- [ ] `ipc.ts`：`chat:send` 处理器在注入文字前先调用 `injectFiles()`（若 `attachments` 非空）
- [ ] `ChatPage.tsx`：`MessageInput` 左侧添加 📎 按钮（当 `activeSite.fileUploadTrigger` 有值时显示）
- [ ] `presets.ts`：补充 ChatGPT / Claude 的 `fileUploadTrigger` 预设值
- [ ] 手动验证：ChatGPT 上传一张图片并发送"描述这张图片"，收到正确回复

**模型切换任务清单**：
- [x] `site-store.ts`：`SiteConfig` 增加 `modelSwitcherSelector`、`availableModels`、`activeModel` 字段
- [x] `site-store.ts`：`add()` 从 preset 传入 `modelSwitcherSelector` + `availableModels`；新增 `setActiveModel(siteId, modelId)` 方法
- [x] `ipc.ts`：注册 `chat:switch-model` 处理器（注入点击脚本，更新 `SiteConfig.activeModel`）
- [x] `ipc.ts`：注册 `chat:list-models` 处理器（返回 `availableModels` + `activeModel`）
- [x] `preload/index.d.ts` + `preload/index.ts`：暴露 `chat.switchModel(siteId, modelId)` + `chat.listModels(siteId)`
- [x] `presets.ts`：为 ChatGPT / Claude / Gemini 添加 `availableModels` 预设列表 + `modelSwitcherSelector`
- [x] `ChatPage.tsx`：`Message.role` 加 `'system'`；`MessageList` 系统消息渲染为居中灰色小字
- [x] `ModelPicker.tsx`：新建组件，当 `activeSite.availableModels` 非空时显示当前模型 + 切换子菜单
- [x] `ChatPage.tsx`：集成 `ModelPicker`；`handleModelSwitch` 清空本地消息 + 追加 system 提示
- [ ] 手动验证：切换到 o1 后发消息，确认 ChatGPT 使用 o1 回答

---

### M12：多 Chat 对话列表（§7.8 V2 实现）

**目标**：ChatPage 左侧出现对话列表面板（类似 ChatGPT 侧边栏），支持新建对话、切换历史对话、重命名/删除。每条对话与 AI 网站上的真实 chat thread 绑定，切换时后台 WebContentsView 自动导航恢复上下文。

---

#### 核心设计决策

**URL 捕获策略**：`did-navigate` 事件在主进程监听，URL 匹配 `chatUrlPattern`（presets 配置的正则）时记录为 `Conversation.chatUrl`。

**切换对话 = 导航**：`webContentsView.webContents.loadURL(chatUrl)` → 等待 `inputSelector` 可见（最多 10s）→ 成功后解锁输入框。

**持久化**：`conversations.json`（userData 目录），结构为 `Record<siteId, Conversation[]>`，与 `sites.json` 独立。

**chatUrl 失效处理**：导航后 10s 内 `inputSelector` 未出现，判定 chatUrl 失效（AI 网站已删除该对话），向渲染进程推送 `conversation:url-dead`，本地保留对话记录但清空 `chatUrl`，提示用户"此对话在 AI 网站已不存在，历史消息仅供参考"。

---

#### 新增 IPC 通道

| 通道 | 方向 | 说明 |
|---|---|---|
| `conversation:list` | 渲染→主 | 返回指定 `siteId` 的 `Conversation[]`，按 `createdAt` 倒序 |
| `conversation:new` | 渲染→主 | 在后台 WebContentsView 导航到网站首页，返回新建的 `Conversation`（无 `chatUrl`，发消息后自动填充） |
| `conversation:switch` | 渲染→主 | 导航到 `chatUrl`，等待 inputSelector 可见，返回 `{ ok: true }` 或 `{ ok: false, reason }` |
| `conversation:rename` | 渲染→主 | 更新 `Conversation.title`，写入持久化 |
| `conversation:delete` | 渲染→主 | 从本地删除记录（不影响 AI 网站上的真实对话） |
| `conversation:url-captured` | 主→渲染 | 首条消息发送后，AI 网站跳转到 chat thread URL，主进程捕获后推送；payload: `{ siteId, conversationId, chatUrl }` |
| `conversation:url-dead` | 主→渲染 | 切换对话时 chatUrl 导航失败；payload: `{ siteId, conversationId }` |

---

#### 新增数据结构

```typescript
// src/main/conversations-store.ts

interface Message {
  id: string
  role: 'user' | 'ai'
  text: string
  ts: number
}

interface Conversation {
  id: string            // UUID，autoAI 内部唯一键
  siteId: string        // 归属账号
  chatUrl?: string      // AI 网站的 chat thread URL（如 chatgpt.com/c/abc123）
  title: string         // 对话标题，默认取第一条用户消息前 20 字
  createdAt: number
  messages: Message[]   // 本地消息镜像，与 AI 网站消息一一对应
}
```

**各网站 chatUrl 匹配模式**（在 `presets.ts` 的 `SitePreset` 中新增 `chatUrlPattern` 字段）：

| 网站 | chatUrlPattern | 示例 |
|---|---|---|
| ChatGPT | `/^https:\/\/chatgpt\.com\/c\//` | `chatgpt.com/c/abc123` |
| Claude | `/^https:\/\/claude\.ai\/chat\//` | `claude.ai/chat/uuid` |
| Gemini | `/^https:\/\/gemini\.google\.com\/app\//` | `gemini.google.com/app/xxx` |
| DeepSeek | `/^https:\/\/chat\.deepseek\.com\/a\/chat\/s\//` | `chat.deepseek.com/a/chat/s/xxx` |
| Kimi | `/^https:\/\/kimi\.moonshot\.cn\/chat\//` | `kimi.moonshot.cn/chat/xxx` |

---

#### 各文件改动说明

**`src/main/conversations-store.ts`（新建）**

职责与 `site-store.ts` 完全对称，改存对话数据。

- `list(siteId): Conversation[]` — 返回该账号的所有对话，按 `createdAt` 倒序
- `create(siteId, title?): Conversation` — 新建对话记录，无 `chatUrl`
- `setChatUrl(conversationId, chatUrl)` — 首条消息后填充 URL
- `appendMessage(conversationId, message)` — 每次收到 `chat:reply` 后追加到本地镜像
- `rename(conversationId, title)`
- `remove(conversationId)`
- `load()` / `save()` — JSON 文件读写（`userData/conversations.json`）
- 启动时自动迁移：若 `conversations.json` 不存在，为每个现有 `siteId` 创建一条标题为 `'默认对话'` 的记录

**`src/main/browser-view.ts`**

- `did-navigate` 监听：在 `ensure()` 创建 WebContentsView 时，同步注册：
  ```typescript
  view.webContents.on('did-navigate', (_e, url) => {
    const preset = findPreset(siteId)
    if (preset?.chatUrlPattern?.test(url)) {
      // 推送到渲染进程：conversation:url-captured
    }
  })
  ```
- `switchConversation(siteId, chatUrl)` — 调用 `loadURL`，超时 10s 轮询 inputSelector 可见性，返回成功/失败

**`src/main/ipc.ts`**

- 注册上表 7 条新 IPC 通道
- `chat:send` 处理器：发送成功后调用 `conversationsStore.appendMessage(conversationId, userMsg)`；收到 `chat:reply` 后追加 AI 消息

**`src/main/presets.ts`**

- `SitePreset` 增加 `chatUrlPattern?: RegExp` 字段
- 为上表 5 个网站填入对应正则

**`src/preload/index.d.ts` + `src/preload/index.ts`**

暴露 `conversation` 命名空间：
```typescript
conversation: {
  list(siteId: string): Promise<Conversation[]>
  new(siteId: string): Promise<Conversation>
  switch(siteId: string, conversationId: string): Promise<{ ok: boolean; reason?: string }>
  rename(conversationId: string, title: string): Promise<void>
  delete(conversationId: string): Promise<void>
  onUrlCaptured(cb: (payload: { siteId: string; conversationId: string; chatUrl: string }) => void): () => void
  onUrlDead(cb: (payload: { siteId: string; conversationId: string }) => void): () => void
}
```

**`src/renderer/src/pages/ChatPage.tsx`**

- 新增 `ConversationSidebar` 组件（宽 200px，左侧，可折叠）
- 每个账号维护独立的 `conversations: Conversation[]` 和 `activeConversationId: string | null`
- 切换账号（`activeSiteId` 改变）时，自动加载该账号的对话列表
- 「+」按钮 → `conversation.new()` → 本地列表追加，`activeConversationId` 切换
- 点击对话条目 → `conversation.switch()` → 等待返回 `{ ok: true }` 后切换 `activeConversationId`、清空本地 `messages`（从 `conversations` 加载历史镜像）
- `onUrlCaptured` 事件：更新本地对话的 `chatUrl`
- `onUrlDead` 事件：对话条目显示 `⚠` 标记，tooltip "此对话在 AI 网站已不存在"
- 消息过滤改为 `message.conversationId === activeConversationId`

---

#### UI 布局（ChatPage 含侧边栏）

```
┌──[●][●][●]──── drag ─────────────────────────────────[⚙]──┐
│  [Claude ▼]                                         [···]  │
├──────────────┬─────────────────────────────────────────────┤
│ 对话列表      │                                              │
│ [+] 新建对话  │  用户 14:01                                  │
│ ─────────── │  帮我改进这段代码                               │
│ ▶ 代码优化   │                                              │
│   论文润色   │          AI 14:01                            │
│   今日摘要   │          好的，以下是优化后的版本…              │
│             │                                              │
│             ├─────────────────────────────────────────────┤
│             │  给 Claude 发消息…                  [发送]   │
└──────────────┴─────────────────────────────────────────────┘
```

- 侧边栏宽度：200px，`shrink-0`
- 右键对话条目：「重命名」/「删除」
- 活跃对话高亮（`bg-gray-100`），悬停显示操作图标
- 折叠按钮（`‹`）：折叠后侧边栏宽度变为 0，主区域占满

---

#### 任务清单

**主进程**
- [ ] 新建 `src/main/conversations-store.ts`，实现 `list / create / setChatUrl / appendMessage / rename / remove / load / save / migrate`
- [ ] `src/main/presets.ts`：`SitePreset` 增加 `chatUrlPattern?: RegExp`，为 5 个网站填入对应正则
- [ ] `src/main/browser-view.ts`：`ensure()` 中注册 `did-navigate` 监听，命中 `chatUrlPattern` 时推送 `conversation:url-captured`；新增 `switchConversation(siteId, chatUrl)` 方法（loadURL + 10s inputSelector 轮询）
- [ ] `src/main/ipc.ts`：注册 7 条新 IPC 通道；`chat:send` + `chat:reply` 处理器追加 `appendMessage` 调用

**Preload**
- [ ] `src/preload/index.d.ts`：新增 `Conversation` 接口定义 + `conversation` 命名空间类型
- [ ] `src/preload/index.ts`：实现 `conversation` 命名空间的 IPC 桥接（invoke + on/off）

**渲染层**
- [ ] `src/renderer/src/pages/ChatPage.tsx`：新增 `ConversationSidebar` 子组件（列表、+ 按钮、折叠、右键菜单）
- [ ] `ChatPage.tsx`：对话状态管理（`conversations`、`activeConversationId`、切换账号时重载列表）
- [ ] `ChatPage.tsx`：消息过滤改为 `message.conversationId === activeConversationId`
- [ ] `ChatPage.tsx`：监听 `onUrlCaptured` / `onUrlDead` 事件，更新本地对话状态

**收尾**
- [ ] 手动验证：ChatGPT 新建对话 → 发消息 → chatUrl 自动填充 → 新建第二条对话 → 切换回第一条 → AI 上下文正确恢复
- [ ] 手动验证：重启应用后，历史对话列表完整还原，点击后 AI 上下文正确恢复

---



| 风险 | 概率 | 对策 |
|---|---|---|
| 自动识别在某些网站失败 | 中 | 校准流程兜底，失败时立刻引导用户校准 |
| 富文本编辑器注入兼容性 | 中 | 三种注入策略按优先级依次尝试 |
| 自动探测误命中非目标元素 | 中 | 收敛的语义选择器候选列表；`calibrated` 保护规则防止错误缓存污染 |
| SPA 页面重渲染导致计数回退 | 中 | `adjustedBeforeCount` 动态重置基线，检测到下降时不报错继续等待 |
| 网站检测到自动化并拦截 | 低 | 使用真实用户会话（非无头浏览器），行为模式接近正常使用 |
| MutationObserver 被 CSP 限制 | 低 | Electron 可以绕过 CSP（executeJavaScript 在主进程执行） |
| 回复稳定后仍有延迟追加 | 低 | 稳定窗口设为 1500ms，足够处理大多数打字动画 |
