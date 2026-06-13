/**
 * Workflow-aware mock OpenAI-compatible endpoint for headless engine runs.
 * Routes by sentinel markers (stage execution) or prompt heuristics (polish / generation).
 */
import http from 'node:http'

export const MOCK_MODEL_ID = 'mock-model'

const POLISH_HINT = '口语化、杂乱的需求草稿'
const GENERATION_HINT = '决策优先工作流生成器'

/** Stage replies keyed by sentinel marker (aligned with e2e/helpers/mock-llm-server.ts). */
const STAGE_REPLIES = {
  'MOCK_STAGE:charter_smoke': 'smoke-ok',
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

function buildWorkflowJson() {
  const wf = {
    id: 'wf_headless_mock_prototype',
    version: '2.0',
    meta: {
      title: 'Headless Mock Prototype 交付闭环',
      taskType: 'prototype',
      userInput: '读取本地表格、对比线上数据并导出 diff 结果 CSV（headless mock）',
      createdAt: new Date().toISOString(),
    },
    stages: [
      {
        id: 'stage_impl_prototype_requirements',
        title: '生成 requirements.txt 依赖清单',
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

const POLISH_REPLY = [
  '**业务目标**：读取本地 input.xlsx，抓取线上价格库存并对比，导出 diff 结果 CSV。',
  '',
  '**功能与范围**：本地表格解析、线上数据抓取、差异分析、CSV 导出。',
  '',
  '**技术与交付假设（可改）**：Python 脚本，pandas + requests。',
  '',
  '**工作流产出要求**：先架构决策，再垂直切片实现与验证。',
].join('\n')

function routeReply(allContent) {
  for (const marker of Object.keys(STAGE_REPLIES)) {
    if (allContent.includes(marker)) {
      return { marker, reply: STAGE_REPLIES[marker] }
    }
  }
  if (allContent.includes(POLISH_HINT)) {
    return { marker: 'task-polish', reply: POLISH_REPLY }
  }
  if (allContent.includes(GENERATION_HINT) || allContent.includes('"stages"')) {
    return { marker: 'generation', reply: buildWorkflowJson() }
  }
  return { marker: 'generation', reply: buildWorkflowJson() }
}

function writeSse(res, content) {
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

/**
 * @returns {Promise<{ url: string, calls: Array<{ marker: string, preview: string }>, close: () => Promise<void> }>}
 */
export function startMockLlmServer() {
  const calls = []

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
            const parsed = JSON.parse(body)
            allContent = (parsed.messages ?? [])
              .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
              .join('\n')
          } catch {
            /* treat as generation */
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
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
