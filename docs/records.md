# 记录、规则与个人通用库（M5-1）

对应规格 §10、D5–D9 与 tasks.md 的 M5-1。代码：`src/records/`、`src/server/flows/records-flow.ts`、`web/src/pages/RulesPage.tsx`。

- **记录卡**：合并（或强行合并）之后，AI 根据回报、失败日志、授权原因起草 0–2 条记录卡，存在 `.stagent/runs/record-drafts.json`（不进账本）。你「保存」才写 `record.saved`，也可以「不记录」。手写：`POST /api/records`。
- **规则提案**：同一标签的 pitfall 达到 2 条、且该标签没有提议中或已接受的规则时，AI 起草一条规则（带适用条件与失效条件）写 `rule.proposed`；AI 不可用时用模板起草，同样等你确认。首页显示规则提案卡。
- **规则区块**：接受（`rule.accepted`）或退役后，重写 `CLAUDE.md` 与 `.cursor/rules/stagent.mdc` 中由 `<!-- stagent:rules -->` … `<!-- /stagent:rules -->` 包裹的区块，区块外内容不动。这两个文件默认在 `evidence.ignoreGlobs` 里，不会让证据过期。
- **偏离提示**：每次读结论卡时比对区块与账本生成的内容（账本里接受过规则才比对）；被你手动改过 → 「规则区块已偏离账本」：`POST /api/rules/regenerate` 以账本为准重新生成，或 `POST /api/rules/keep` 保留现状（本次运行期间不再提示同一处）。
- **度量**：每条规则统计生效后同标签 pitfall 数与合并的改动数；生效后已有 ≥ 10 次合并、同类坑仍在出现时提示退役或改写。
- **删除记录**：需要 `delete` 授权（`POST /api/auth { action: 'delete', recordId, reason }`），写 `record.deleted`。
- **个人通用库**：保存记录或接受规则时勾选「同步到个人通用库」→ `~/.stagent/library/<id>.md`（带技术栈标签）。`GET /api/library` 按本项目技术栈列出，`POST /api/library/:id/import` 作为规则提案引入（仍要你确认）。

推断：「连续 10 次改动没有起作用」理解为「生效后 ≥ 10 次合并、同类坑仍出现」。
