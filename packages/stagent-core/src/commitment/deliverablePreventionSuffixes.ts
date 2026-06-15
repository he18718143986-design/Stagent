/**
 * ADR-0009：交付可运行性预防指引（prevention-at-impl，遵循 ADR-0007 成对模式）。
 *
 * 针对 T6「空心绿」复跑暴露的三类反模式，在初始 impl / test_write 阶段就注入预防文案，
 * 而非只在撞门（ADR-0008 冒烟门 / 协作者 mock 检测）后才纠正：
 *   1. main() 定义却从未被调用 → `python main.py` 空转、无产出。
 *   2. 为过导出契约塞占位符（`X = X` / `null = None` / 无意义模块级常量）。
 *   3. 测试整体 mock 内部协作者后只断言 call shape（tdd/mocking 明文禁止）。
 *
 * 文案与 ADR-0008 门的 message、`collaborator-mock-only` lint 同源，避免漂移。
 */

/** main 切片名（与 semanticNameFromImplStageId 对齐）。 */
const MAIN_SEMANTIC = 'main';

/**
 * 决策 1（ADR-0009）：主入口可运行约束——仅对 main 切片 impl 注入。
 * 无关切片返回 null（避免噪声 / token 浪费）。
 */
export function buildMainEntryRunnablePreventionSuffix(semantic: string | undefined): string | null {
  if (semantic !== MAIN_SEMANTIC) {
    return null;
  }
  return [
    '## 主入口可运行约束（ADR-0009，必须遵守）',
    '本切片是程序主入口（main）。落盘文件必须**真正可运行**，而非只定义函数：',
    '- **必须**在文件末尾包含 `if __name__ == "__main__":` 守卫并在其中调用主函数（如 `main()`）。只定义 `def main()` 却不调用 = `python main.py` 空转无产出，会被冒烟门硬拦。',
    '- 主函数必须真正执行业务路径：读输入 → 调用各切片 → 把结果写到声明的输出文件（如 `summary.json`）。',
    '- **写输出文件前必须确保目录存在**：若输出路径含子目录（如 `output/summary.json`），先 `os.makedirs(os.path.dirname(path), exist_ok=True)` 再写，否则 FileNotFoundError。',
    '- 禁止用宽 `except` 吞掉致命错误；`python <entry>` 必须以非零退出暴露失败，且正常路径产出非平凡结果。',
  ].join('\n');
}

/**
 * 决策 2（ADR-0009）：禁止占位导出——对所有 impl 切片注入（短文案，跨切通用）。
 */
export function buildNoPlaceholderExportPreventionSuffix(): string {
  return [
    '## 禁止占位导出（ADR-0009，必须遵守）',
    '禁止为「满足导出契约」塞入无功能意义的占位符：',
    '- 自赋值：`PermissionError = PermissionError`、`FileNotFoundError = FileNotFoundError`。',
    '- 无意义模块级常量：`null = None`、仅为让符号存在的 `csv_path = None`。',
    '每个导出符号必须是真实的函数/类/有意义的值；契约要求的符号若无真实实现，应**实现它**而非占位。占位导出会被导出真实性校验与架构扫（ADR-0009）标记。',
  ].join('\n');
}

/**
 * 决策 3（ADR-0009 / tdd mocking）：测试须验证真实协作者行为——对 test_write 切片注入。
 * 与 `collaborator-mock-only` lint（ADR-0008 决策 2）同源，提前预警假绿。
 */
export function buildRealCollaboratorTestPreventionSuffix(semantic: string | undefined): string {
  const slice = semantic ? `\`${semantic}\`` : '本';
  return [
    '## 测试须验证真实协作者（ADR-0009 / tdd，必须遵守）',
    `${slice} 切片的测试要测「行为」而非「调用形状」：`,
    '- 禁止把被测模块的直接协作者**整体**换成 `MagicMock` / `vi.fn()` 后**只**断言 `assert_called_with` / `toHaveBeenCalledWith` / `call_count`。',
    '- 集成点（如 main、pipeline）须用**真实协作者**或公共 API 断言可观测结果（如真实 store 落库后 `summarize` 的统计、真实导入后的产出文件）。',
    '- 只 mock 进程外/不确定性依赖（网络、时钟、文件系统边界），不 mock 本工程内部切片。整体 mock 协作者只断言 call shape 会被 `collaborator-mock-only` 检测标记，且无法捕获签名不匹配等集成 bug。',
  ].join('\n');
}
