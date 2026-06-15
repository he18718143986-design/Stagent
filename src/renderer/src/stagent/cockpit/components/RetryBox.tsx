import React, { useState } from 'react'

export function RetryBox({ onRetry }: { onRetry: (comment: string) => void }): React.JSX.Element {
  const [comment, setComment] = useState('')
  return (
    <div className="space-y-2 mt-2">
      <textarea
        className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[2.5rem]"
        placeholder="给重试一些纠偏意见（可留空）…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        type="button"
        className="text-sm bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700"
        onClick={() => onRetry(comment.trim())}
      >
        重试此阶段
      </button>
    </div>
  )
}

export function renderOutput(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}
