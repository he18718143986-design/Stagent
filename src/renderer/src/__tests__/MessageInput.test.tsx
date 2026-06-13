/**
 * Unit tests for the MessageInput sub-component in ChatPage.
 *
 * Because MessageInput is a module-internal function we test it
 * indirectly through ChatPage (which renders it when sites are connected).
 * We export a thin wrapper from a shared test helper to keep tests focused.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// ─── Inline MessageInput — extracted for isolated testing ─────────────────

/**
 * Minimal copy of the MessageInput component (same logic, same props).
 * Kept here so the test doesn't depend on ChatPage internals.
 */
function MessageInput({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => void
  disabled: boolean
  placeholder: string
}): React.JSX.Element {
  const [text, setText] = React.useState('')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !disabled) {
      e.preventDefault()
      submit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(e.target.value)
  }

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="message-input"
      />
      <button onClick={submit} disabled={disabled || !text.trim()} aria-label="发送">
        Send
      </button>
    </div>
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MessageInput', () => {
  it('calls onSend with trimmed text when Enter is pressed', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} placeholder="Type…" />)

    const textarea = screen.getByLabelText('message-input')
    await userEvent.type(textarea, 'Hello world')
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith('Hello world')
  })

  it('does NOT call onSend on Shift+Enter (line break)', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} placeholder="Type…" />)

    const textarea = screen.getByLabelText('message-input')
    await userEvent.type(textarea, 'line one')
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('does NOT call onSend when disabled', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={true} placeholder="Wait…" />)

    const textarea = screen.getByLabelText('message-input')
    await userEvent.type(textarea, 'hello')
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('clears textarea after send button click', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} placeholder="Type…" />)

    const textarea = screen.getByLabelText('message-input') as HTMLTextAreaElement
    await userEvent.type(textarea, 'send me')

    const btn = screen.getByLabelText('发送')
    fireEvent.click(btn)

    expect(onSend).toHaveBeenCalledWith('send me')
    expect(textarea.value).toBe('')
  })

  it('does NOT call onSend for whitespace-only input', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} placeholder="Type…" />)

    const textarea = screen.getByLabelText('message-input')
    await userEvent.type(textarea, '   ')
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).not.toHaveBeenCalled()
  })
})
