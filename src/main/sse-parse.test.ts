import { describe, it, expect } from 'vitest'
import { accumulateSseText, extractFromSseDataLine } from './sse-parse'

describe('sse-parse', () => {
  it('extractFromSseDataLine parses ChatGPT v field', () => {
    expect(extractFromSseDataLine('{"v":"hello"}')).toBe('hello')
  })

  it('accumulateSseText joins multiple data lines', () => {
    const body = 'data: {"v":"a"}\ndata: {"v":"b"}\n'
    expect(accumulateSseText(body)).toBe('ab')
  })
})
