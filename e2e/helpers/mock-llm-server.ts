/**
 * Workflow-aware mock of an OpenAI-compatible LLM endpoint.
 *
 * Stagent's Electron host can be pointed at a "direct" OpenAI-compatible API by
 * seeding `stagent/config.json` with llmApiKey + llmBaseUrl (see seed-stagent.ts).
 * This server stands in for that API so a full prototype workflow can run
 * end-to-end WITHOUT touching the user's real ChatGPT/Claude accounts.
 *
 * Routing — the engine sends each call as chat/completions with the stage's
 * systemPrompt. We embed a sentinel marker (`MOCK_STAGE:<name>`) in each stage's
 * systemPrompt in the generated workflow JSON, then route the reply by marker.
 * Any call WITHOUT a stage marker is treated as the workflow-generation call and
 * returns the canned prototype workflow JSON.
 *
 * Responses are streamed as OpenAI SSE (`data: {...}\n\n` … `data: [DONE]`)
 * because the direct model always requests `stream: true` and the engine parses
 * it via parseSseDeltaStream.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export const MOCK_MODEL_ID = 'mock-model'

export interface MockLlmServer {
  url: string
  /** Records of every chat/completions call, for assertions/debugging. */
  calls: Array<{ marker: string; preview: string }>
  close: () => Promise<void>
}

/**
 * Canned prototype workflow — ALL stages are llm-text (no code-runner → no
 * python, no decision stage → no mandatory HITL). It demonstrates the delivery
 * closure shape (writer + main) and, crucially, includes a requirements.txt
 * impl stage which is the regression target for the confidence-pause fix (#4).
 */
function buildWorkflowJson(): string {
  const wf = {
    id: 'wf_e2e_mock_prototype',
    version: '2.0',
    meta: {
      title: 'E2E Mock Prototype 交付闭环',
      taskType: 'prototype',
      userInput: '读取本地表格、对比线上数据并导出 diff 结果 CSV（端到端 mock）',
      createdAt: '2026-05-30T00:00:00.000Z',
    },
    stages: [
      {
        id: 'stage_impl_prototype_requirements',
        title: '生成 requirements.txt 依赖清单',
        description: '声明运行所需的 Python 依赖（短文本产物，不应触发置信度误暂停）',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt:
            'MOCK_STAGE:requirements 只输出 requirements.txt 的内容，每行一个依赖，不要代码块、不要解释。',
          writeOutputToFile: 'requirements.txt',
        },
        input: { sources: [{ type: 'user-input', label: '任务' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'requirements', format: 'text' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_prototype_writer',
        title: '实现 writer.py（产出 CSV 交付物）',
        description: '提供 write_csv(rows, path) 将结果写入 output.csv',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt: 'MOCK_STAGE:writer 实现 writer.py，提供 write_csv(rows, path)。',
          writeOutputToFile: 'writer.py',
        },
        input: { sources: [{ type: 'user-input', label: '任务' }], mergeStrategy: 'concat' },
        outputs: [{ key: 'writerCode', format: 'markdown' }],
        pauseAfter: false,
      },
      {
        id: 'stage_impl_prototype_main',
        title: '实现 main.py（串联流程并写出交付物）',
        description: '入口：read→fetch→analyze→write，调用 writer.write_csv 产出 output.csv',
        tool: 'llm-text',
        toolConfig: {
          type: 'llm-text',
          systemPrompt:
            'MOCK_STAGE:main 实现 main.py，import writer 并调用 write_csv 写出 output.csv。',
          writeOutputToFile: 'main.py',
        },
        input: {
          sources: [
            {
              type: 'stage-output',
              stageId: 'stage_impl_prototype_writer',
              outputKey: 'writerCode',
              label: 'writer',
            },
          ],
          mergeStrategy: 'concat',
        },
        outputs: [{ key: 'mainCode', format: 'markdown' }],
        pauseAfter: false,
      },
    ],
  }
  return JSON.stringify(wf)
}

/** Stage replies keyed by sentinel marker. */
const STAGE_REPLIES: Record<string, string> = {
  // Short, no code fence — the exact shape that pre-fix scored 0.28/critical.
  'MOCK_STAGE:requirements': 'pandas\nnumpy\nopenpyxl\nrequests\npython-dotenv',
  'MOCK_STAGE:writer': [
    '```python',
    '# writer.py',
    'import csv',
    '',
    'def write_csv(rows, path):',
    '    fieldnames = list(rows[0].keys()) if rows else ["asin", "diff"]',
    '    with open(path, "w", newline="", encoding="utf-8-sig") as f:',
    '        w = csv.DictWriter(f, fieldnames=fieldnames)',
    '        w.writeheader()',
    '        w.writerows(rows)',
    '    return path',
    '```',
  ].join('\n'),
  'MOCK_STAGE:main': [
    '```python',
    '# main.py',
    'from writer import write_csv',
    '',
    'def main():',
    '    rows = [{"asin": "A1", "diff": 1.5}]',
    '    return write_csv(rows, "output.csv")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '```',
  ].join('\n'),
}

function routeReply(allContent: string): { marker: string; reply: string } {
  for (const marker of Object.keys(STAGE_REPLIES)) {
    if (allContent.includes(marker)) {
      return { marker, reply: STAGE_REPLIES[marker] }
    }
  }
  return { marker: 'generation', reply: buildWorkflowJson() }
}

function writeSse(res: http.ServerResponse, content: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const chunk = { choices: [{ index: 0, delta: { content }, finish_reason: null }] }
  res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

export async function startMockLlmServer(): Promise<MockLlmServer> {
  const calls: MockLlmServer['calls'] = []

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? ''

      if (req.method === 'GET' && url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: MOCK_MODEL_ID }] }))
        return
      }

      if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          let allContent = ''
          try {
            const parsed = JSON.parse(body) as {
              messages?: Array<{ content?: unknown }>
            }
            allContent = (parsed.messages ?? [])
              .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
              .join('\n')
          } catch {
            /* ignore — treated as generation */
          }
          const { marker, reply } = routeReply(allContent)
          calls.push({ marker, preview: allContent.slice(0, 120) })
          writeSse(res, reply)
        })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `unhandled ${req.method} ${url}` } }))
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}
