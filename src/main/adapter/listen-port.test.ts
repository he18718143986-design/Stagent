import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { listenWithPortFallback } from './listen-port'

const HOST = '127.0.0.1'
const open: Server[] = []

function track(s: Server): Server {
  open.push(s)
  return s
}

/** Listen a blocker server on an OS-assigned port; resolve that port. */
function occupy(): Promise<number> {
  const s = track(createServer())
  return new Promise((resolve) => s.listen(0, HOST, () => resolve((s.address() as AddressInfo).port)))
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe('listenWithPortFallback', () => {
  it('binds the requested port when it is free', async () => {
    const taken = await occupy()
    const free = taken + 1
    const server = track(createServer())
    const bound = await listenWithPortFallback(server, HOST, free, 10)
    expect(bound).toBe(free)
    expect(server.listening).toBe(true)
  })

  it('falls back to the next port when the requested one is in use', async () => {
    const taken = await occupy()
    const server = track(createServer())
    const bound = await listenWithPortFallback(server, HOST, taken, 10)
    expect(bound).toBe(taken + 1)
    expect(server.listening).toBe(true)
  })

  it('rejects when no port is found within maxAttempts', async () => {
    const taken = await occupy()
    const server = track(createServer())
    // Only allow 1 attempt on an occupied port → no room to fall back.
    await expect(listenWithPortFallback(server, HOST, taken, 1)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })
})
