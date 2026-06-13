/* ------------------------------------------------------------------ */
/*  FileEditor — 中央文件查看/编辑器（textarea + 保存写回磁盘）          */
/*                                                                     */
/*  经 fsRead 读入 filePath 内容，可编辑并 fsWrite 写回（Cmd/Ctrl+S）。   */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react'

export default function FileEditor({
  filePath,
  name,
  onClose,
}: {
  filePath: string
  name: string
  onClose: () => void
}): React.JSX.Element {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFileError(null)
    setSavedHint(false)
    void window.autoAI.stagent.fsRead(filePath).then((res) => {
      if (cancelled) {
        return
      }
      if (res.ok && typeof res.content === 'string') {
        setContent(res.content)
        setSavedContent(res.content)
      } else {
        setContent('')
        setSavedContent('')
        setFileError(res.error ?? '读取文件失败')
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const dirty = content !== savedContent

  const save = useCallback(async () => {
    if (!dirty) {
      return
    }
    setSaving(true)
    const res = await window.autoAI.stagent.fsWrite(filePath, content)
    setSaving(false)
    if (res.ok) {
      setSavedContent(content)
      setSavedHint(true)
      setTimeout(() => setSavedHint(false), 1500)
    } else {
      setFileError(res.error ?? '保存失败')
    }
  }, [dirty, filePath, content])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <span className="text-sm text-gray-700 truncate" title={filePath}>
          {name}
          {dirty && <span className="text-amber-500"> ●</span>}
        </span>
        {savedHint && <span className="text-xs text-green-600">已保存 ✓</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
            disabled={!dirty}
            onClick={() => setContent(savedContent)}
          >
            撤销修改
          </button>
          <button
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-40"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="text-xs text-gray-500 hover:text-gray-800" onClick={onClose}>
            关闭文件
          </button>
        </div>
      </div>
      {fileError ? (
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">
          无法编辑：{fileError}
        </div>
      ) : (
        <textarea
          className="flex-1 w-full resize-none font-mono text-[13px] leading-5 p-3 outline-none text-gray-800"
          spellCheck={false}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault()
              void save()
            }
          }}
        />
      )}
    </div>
  )
}
