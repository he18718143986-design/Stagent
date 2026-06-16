/**
 * 从决策记录(decisionRecord, markdown)中提取「AI 无法验证的假设」条目。
 * 用于决策闸门的「逼出判断」:这些是 AI 替你做不了核实、需你知悉并担责的点。
 * content-lint 已强制存在 `### AI 无法验证的假设` 小节,解析稳定;解析不到则返回 []。
 * 纯函数,便于单测。
 */

const ASSUMPTION_HEADING = /^#{1,6}\s*AI\s*无法验证的假设/i

function stripBulletPrefix(line: string): string {
  // 先去列表符号(-/*/•/1.),再去「假设N：」式编号标签(要求冒号结尾,避免误删
  // 「假设 X 成立」这类正文措辞)。
  return line
    .replace(/^\s*(?:[-*•]|\d+[.、)])\s*/u, '')
    .replace(/^假设\s*\d*\s*[：:]\s*/u, '')
    .trim()
}

export function extractDecisionAssumptions(text: string, max = 8): string[] {
  if (!text) {
    return []
  }
  const lines = text.split(/\r?\n/)
  let inSection = false
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) {
      // 到了某个标题:进入目标小节或离开
      inSection = ASSUMPTION_HEADING.test(line)
      continue
    }
    if (!inSection || line.length === 0) {
      continue
    }
    const cleaned = stripBulletPrefix(line)
    if (cleaned.length > 0) {
      out.push(cleaned)
    }
    if (out.length >= max) {
      break
    }
  }
  return out
}
