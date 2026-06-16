import React, { useState } from 'react'
import FileTree, { type FsNode } from '../../../pages/FileTree'
import { countTreeFiles } from '../derive/countTreeFiles'

/**
 * 成果生长面板:把工作区文件树做成"从无到有"的成果展示。
 * 文件随每一步落盘出现(refreshNonce 触发重载),新文件高亮 + 计数随之上行。
 */
export function ArtifactsPanel({
  rootPath,
  newPaths,
  refreshNonce,
  onSelectFile,
  onOpenFolder,
  selectedFilePath = null,
}: {
  rootPath: string
  newPaths?: Set<string>
  refreshNonce?: number
  onSelectFile?: (node: FsNode) => void
  onOpenFolder?: () => void
  selectedFilePath?: string | null
}): React.JSX.Element {
  const [count, setCount] = useState<{ files: number; dirs: number }>({ files: 0, dirs: 0 })
  const hasNew = !!newPaths && newPaths.size > 0

  return (
    <div className="rounded-2xl border border-white/10 bg-stagent-surface/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">成果</span>
          {hasNew && <span className="w-1.5 h-1.5 rounded-full bg-stagent-accent animate-pulse" aria-hidden="true" />}
        </div>
        <span className="text-xs text-slate-400 tabular-nums">
          已生成 {count.files} 个文件{count.dirs > 0 ? ` · ${count.dirs} 个文件夹` : ''}
        </span>
      </div>

      {!rootPath ? (
        <div className="text-xs text-slate-500 py-3">还没有工作文件夹</div>
      ) : (
        <div className="max-h-72 overflow-y-auto -mx-1">
          <FileTree
            rootPath={rootPath}
            selectedPath={selectedFilePath}
            newPaths={newPaths}
            refreshNonce={refreshNonce}
            onSelectFile={onSelectFile ?? (() => {})}
            onTreeLoaded={(t) => setCount(countTreeFiles(t))}
          />
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
        <span className="text-[11px] text-slate-500">文件随每一步自动出现</span>
        {onOpenFolder && (
          <button
            type="button"
            className="text-xs text-slate-300 hover:text-stagent-accent transition-colors"
            onClick={onOpenFolder}
          >
            📁 打开文件夹
          </button>
        )}
      </div>
    </div>
  )
}
