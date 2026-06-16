/* ------------------------------------------------------------------ */
/*  FileTree — 工作目录文件树（VS Code 式，可内嵌）                      */
/*                                                                     */
/*  渲染 rootPath 下的真实磁盘文件树（经 fsTree IPC）。点击文件回调       */
/*  onSelectFile；refreshNonce 变化时重载；newPaths 命中的文件标「● 新」。 */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react'

export interface FsNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: FsNode[]
}

function FileIcon({ type, open }: { type: 'dir' | 'file'; open?: boolean }): React.JSX.Element {
  if (type === 'dir') {
    return <span className="inline-block w-4 text-slate-500">{open ? '▾' : '▸'}</span>
  }
  return <span className="inline-block w-4" />
}

function TreeNode({
  node,
  depth,
  selectedPath,
  newPaths,
  onSelect,
}: {
  node: FsNode
  depth: number
  selectedPath: string | null
  newPaths?: Set<string>
  onSelect: (n: FsNode) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const isSelected = node.type === 'file' && node.path === selectedPath
  const isNew = node.type === 'file' && !!newPaths && (newPaths.has(node.path) || newPaths.has(node.name))
  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-0.5 text-sm cursor-pointer rounded transition-colors ${
          isSelected
            ? 'bg-stagent-accent/20 text-slate-100'
            : isNew
              ? 'bg-stagent-accent/10 text-slate-100 ring-1 ring-stagent-accent/30'
              : 'hover:bg-white/5 text-slate-300'
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        title={node.path}
        onClick={() => (node.type === 'dir' ? setOpen((v) => !v) : onSelect(node))}
      >
        <FileIcon type={node.type} open={open} />
        <span className="truncate">{node.name}</span>
        {isNew && <span className="ml-auto text-[10px] font-medium text-stagent-accent shrink-0">● 新</span>}
      </div>
      {node.type === 'dir' && open && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              selectedPath={selectedPath}
              newPaths={newPaths}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FileTree({
  rootPath,
  selectedPath,
  newPaths,
  refreshNonce,
  baseDepth = 0,
  onSelectFile,
  onTreeLoaded,
}: {
  rootPath: string
  selectedPath: string | null
  newPaths?: Set<string>
  /** 变化即重载文件树（产物落盘后由父级递增）。 */
  refreshNonce?: number
  /** 内嵌进任务节点时的起始缩进层级。 */
  baseDepth?: number
  onSelectFile: (node: FsNode) => void
  /** 每次成功加载后回传整棵树（供父级统计文件数等）。 */
  onTreeLoaded?: (tree: FsNode) => void
}): React.JSX.Element {
  const [tree, setTree] = useState<FsNode | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)

  const loadTree = useCallback(async () => {
    setTreeError(null)
    const api = window.autoAI?.stagent
    if (!api?.fsTree) {
      setTree(null)
      setTreeError('文件树不可用')
      return
    }
    const res = await api.fsTree(rootPath)
    if (res.ok && res.tree) {
      setTree(res.tree as FsNode)
      onTreeLoaded?.(res.tree as FsNode)
    } else {
      setTree(null)
      setTreeError(res.error ?? '读取目录失败')
    }
  }, [rootPath, onTreeLoaded])

  useEffect(() => {
    void loadTree()
  }, [loadTree, refreshNonce])

  const pad = `${baseDepth * 12 + 6}px`
  if (treeError) {
    return <div className="px-2 py-1 text-xs text-red-400" style={{ paddingLeft: pad }}>{treeError}</div>
  }
  if (!tree) {
    return <div className="px-2 py-1 text-xs text-slate-500" style={{ paddingLeft: pad }}>加载中…</div>
  }
  if (!tree.children || tree.children.length === 0) {
    return <div className="px-2 py-1 text-xs text-slate-500" style={{ paddingLeft: pad }}>空目录</div>
  }
  return (
    <div>
      {tree.children.map((c) => (
        <TreeNode
          key={c.path}
          node={c}
          depth={baseDepth + 1}
          selectedPath={selectedPath}
          newPaths={newPaths}
          onSelect={onSelectFile}
        />
      ))}
    </div>
  )
}
