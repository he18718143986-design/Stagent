/** Sidebar webview ↔ 扩展消息 `type` 常量（与主面板 FrontendMessage 分协议）。 */

export const SIDEBAR_MSG_READY = 'ready' as const;
export const SIDEBAR_MSG_SET_PROFILE = 'setProfile' as const;
export const SIDEBAR_MSG_SET_MODEL = 'setModel' as const;
export const SIDEBAR_MSG_RETRY = 'retry' as const;
export const SIDEBAR_MSG_REFRESH = 'refresh' as const;
export const SIDEBAR_MSG_OPEN_SETTINGS = 'openSettings' as const;
export const SIDEBAR_MSG_RESUME_TASK = 'resumeTask' as const;
export const SIDEBAR_MSG_DELETE_TASK = 'deleteTask' as const;
export const SIDEBAR_MSG_NEW_TASK = 'newTask' as const;
export const SIDEBAR_MSG_UPDATE_STATE = 'updateState' as const;
export const SIDEBAR_MSG_UPDATE_LIST = 'updateList' as const;
