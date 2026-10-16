# 功能文件映射与系统地图（M4-3）

对应规格 §4.5、§11、D27 与 tasks.md 的 M4-3。代码：`src/map/map.ts`（纯投影）、`src/server/flows/map-flow.ts`、`web/src/pages/MapPage.tsx`。

> 此地图来自改动历史，不是代码依赖分析；用于理解和定位，不影响检查范围（**Invariant 8**：`projection.ts` / `changes.ts` 不引用映射，测试 `test/map/map.test.ts` 验证映射事件不改变任何证据状态）。

## 映射从哪里来（后者覆盖前者对同一路径的结论）

1. 扫描接入：`feature.created(origin:'scan').entryFiles`；
2. 每次合并：`change.merged.files` 按本改动最近一条 `change.files_attributed` 归属，**并入**已有归属；`deleted` 移出映射，`renamed` 把旧路径的归属迁到新路径；
3. 手动纠正：`feature.files_reassigned`（替换该路径的归属）。

每个（文件, 功能）记录被改次数与最近一次改动，用于排序；被 ≥ 3 个功能共享的文件是「共享热点」。

## 归属如何产生

每轮回归之后（以及合并 / 强行合并之前）服务端为进行中的改动写 `change.files_attributed`，文件集合没变就不重写：

| 档位 | 归属 |
|---|---|
| 新功能档 | 目标功能（`source: 'target'`），已归属其他功能的文件保留原归属并追加 |
| 小改动 / 计划步骤 / 外部改动 | AI 提出并自动采用（`source: 'ai'`，不请你确认）；AI 不可用时按已有映射，没有则按目标功能 |
| 你改过的（`PUT /api/changes/:id/attributions`） | `source: 'user'`，之后的自动归属保留它 |

## 影响提示

- **触及的功能**：diff 文件在映射中的功能集合；
- **超出本功能的改动**：归属与 `targetFeatureIds` 不相交的文件，以及共享热点；外部改动没有目标功能，不显示这一区块；
- **失败定位**：功能被破坏时，「它的文件 ∩ 本改动 diff」列为可能相关的改动文件，并交给修复提示。

`targetFeatureIds`：新功能档 = 新建的功能 + `change.started.targetFeatureIds`；计划步骤 = 步骤的 `featureIds`；小改动 = AI 在开始时给出。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/map` | 功能 → 文件、最近 5 次改动、共享热点、未归属文件 |
| GET | `/api/map/files?path=` | 文件属于哪些功能 |
| POST | `/api/map/files` | `{ path, featureIds, note? }` 手动纠正 |
| PUT | `/api/changes/:id/attributions` | 修改本改动的文件归属 |
| GET | `/api/changes/:id/diff` | 「改了什么」，含影响提示与失败定位 |

系统地图同时写成 `.stagent/docs/system-map.md`（见 [report.md](report.md)）。
