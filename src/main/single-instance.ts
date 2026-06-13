/* ------------------------------------------------------------------ */
/*  single-instance.ts — 单实例聚焦助手                                 */
/*                                                                     */
/*  app.requestSingleInstanceLock() 拿不到锁时第二个实例应直接退出；    */
/*  已有实例收到 'second-instance' 事件时把主窗口拉回前台，而不是让     */
/*  macOS 弹「应用程序"Electron"已不能再打开」。                        */
/*  聚焦逻辑抽成纯函数，便于单测（不依赖真正的 BrowserWindow）。        */
/* ------------------------------------------------------------------ */

/** BrowserWindow 中本助手需要的最小子集。 */
export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * 把已有主窗口拉回前台：最小化则先还原，再 show + focus。
 * 窗口不存在或已销毁时返回 false（无可聚焦窗口）。
 */
export function focusExistingWindow(win: FocusableWindow | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return true
}
