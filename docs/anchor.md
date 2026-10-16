# 完整性加固：链头锚点与恢复协议（M6-1）

对应规格 §4.1（标注 M6 的部分）与 tasks.md 的 M6-1。代码：`src/ledger/anchor.ts`、`src/ledger/ledger.ts`。

## 锚点与原子写入协议

`~/.stagent/projects/<projectId>/head`（`STAGENT_HOME` 可改根目录）保存链尾 hash。**每次**追加（包括 hook CLI 离线写入、接受当前状态、TOFU、恢复）：

1. 计算新事件的 hash；
2. 先写 `head.tmp` 并 fsync（本次 append 的意图）；
3. 追加事件行并 fsync；
4. `head.tmp` rename 为 `head`，fsync 目录。

新账本（`stagent init`）与 meta 行一起建立 head，不需要 TOFU。`STAGENT_ANCHOR=off` 可关闭（只校验链内一致性）。

## 启动（以及每次写入前）规则

| 规则 | 情况 | 结果 |
|---|---|---|
| 3 | head == 链尾 | 正常；残留 head.tmp 删除 |
| 4 | head 是链上历史事件，且 head.tmp == 链尾 | 崩溃恢复：完成 rename，自动写 `ledger.head_recovered`，不锁定（#8） |
| 5 | head 落后，但 head.tmp 不存在或 ≠ 链尾 | 外部追加 → 完整性冲突 🔒，不自动前移 head（#18） |
| 6 | head 缺失 | 🔒「无法核对历史锚点」，确认前不建立 head、不允许写入；`POST /api/ledger/recover { mode: 'establish_trust' }` 写 `ledger.trust_established`（#7） |
| 7 | head 与链上任何事件都对不上 | 🔒 完整性冲突 |

冲突（5、7）时两个选项：

- 「从 git 历史恢复」`{ mode: 'from_git' }`：在提交过的 events.jsonl 里优先取包含本机锚点的最近合法版本，没有则取最近合法版本，连同 `snapshots/` 一起恢复，写 `ledger.restored`，head 一并前移；
- 「我确认，接受当前状态」`{ mode: 'accept_current' }`：写 `ledger.integrity_override { brokenLinks: [] }`（原因里注明外部锚点冲突），head 前移；交付报告显式标注为「用户接受了无法证明完整性的状态」。

链本身断裂（规则 2）仍按 M1-1 处理，现在多了「从 git 历史恢复」。

## 局限

- 判断依赖原子写入协议：只覆盖单次 append 的崩溃窗口。另一个进程恰好在第 3、4 步之间只读打开账本时，会按规则 4 替写入方完成恢复（写一条 `ledger.head_recovered`）；服务运行时它是账本唯一写入者，这种情况只在离线 hook 与服务同时写时可能出现。
- 锚点和账本在同一台机器上：能识别"整本重写 / 外部追加"，不能防同时改写两者的人。
