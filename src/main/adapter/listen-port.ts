/* ------------------------------------------------------------------ */
/*  listen-port.ts — HTTP 监听端口占用回退                              */
/*                                                                     */
/*  本地适配器固定监听 8787；若被占用（如同时跑了第二个实例）原先会直接 */
/*  抛 EADDRINUSE。这里在 EADDRINUSE 时自动尝试下一个端口，直到成功或    */
/*  达到最大尝试次数，返回实际绑定的端口（getInfo().url 据此回填）。     */
/*  纯 node:net/http，无 electron 依赖，便于单测。                       */
/* ------------------------------------------------------------------ */

import type { Server } from 'node:http'

interface ErrnoException extends Error {
  code?: string
}

/**
 * 在 startPort 起逐个尝试监听，遇 EADDRINUSE 则 +1 重试，最多 maxAttempts 次。
 * 成功时 resolve 实际绑定端口；其他错误或耗尽尝试次数时 reject。
 */
export function listenWithPortFallback(
  server: Server,
  host: string,
  startPort: number,
  maxAttempts = 10,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort
    let attempts = 0

    const tryListen = (): void => {
      attempts += 1

      const onError = (err: ErrnoException): void => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          port += 1
          // listen() 失败后 server 未进入监听态，可安全再次 listen。
          setImmediate(tryListen)
        } else {
          reject(err)
        }
      }

      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        resolve(port)
      })
    }

    tryListen()
  })
}
