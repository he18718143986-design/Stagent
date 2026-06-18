# Vendored OpenHands SDK (Scheme A)

精简 vendoring：仅 **openhands-sdk** + **openhands-tools** + **LICENSE**。

| 项 | 值 |
|----|-----|
| 版本 | 1.28.0 |
| 来源 | https://github.com/OpenHands/software-agent-sdk |
| 本地导入路径 | `/Users/tina/Downloads/software-agent-sdk-main`（2026-06-18 手工复制） |
| 未包含 | agent-server、workspace、examples、tests |

## 安装到 Stagent venv

```bash
npm run codeact:install
```

## 升级

1. 从 upstream 下载新版本，确认 `openhands-sdk` 与 `openhands-tools` **同版本**。
2. 覆盖 `openhands-sdk/`、`openhands-tools/`，更新本文件版本号与 `THIRD_PARTY_NOTICES.md`。
3. 运行 `npm run codeact:smoke` 与 T7 hybrid 回归。

## 命名空间注意

包内模块为 `openhands.sdk`、`openhands.tools`。**勿**在 Stagent 仓库根新建顶层 `openhands/` 目录。
