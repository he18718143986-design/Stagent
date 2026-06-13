/**
 * 澄清问题 JSON 解析：严格 extractJsonObject 失败时，从截断输出中提取已完整的 question 对象。
 */

export interface ClarifyQuestionParsed {
  id: string;
  text: string;
  options?: string[];
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/**
 * 从可能截断的模型输出中提取 question 条目。
 * - 优先匹配带完整 options 的对象；
 * - 再匹配仅有 id+text 的条目（options 被截断时仍能展示问题文案）。
 */
export function lenientExtractClarifyQuestions(raw: string): ClarifyQuestionParsed[] {
  const byId = new Map<string, ClarifyQuestionParsed>();

  const fullRe =
    /\{\s*"id"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"(?:\s*,\s*"options"\s*:\s*(\[[^\]]*\]))?\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = fullRe.exec(raw)) !== null) {
    pushQuestion(byId, m[1], m[2], m[3]);
  }

  const partialRe = /\{\s*"id"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  while ((m = partialRe.exec(raw)) !== null) {
    const id = unescapeJsonString(m[1]).trim() || `q_partial_${byId.size + 1}`;
    if (byId.has(id)) {
      continue;
    }
    const text = unescapeJsonString(m[2]).trim();
    if (text) {
      byId.set(id, { id, text });
    }
  }

  return Array.from(byId.values());
}

function pushQuestion(
  byId: Map<string, ClarifyQuestionParsed>,
  idRaw: string,
  textRaw: string,
  optionsRaw: string | undefined,
): void {
  const text = unescapeJsonString(textRaw).trim();
  if (!text) {
    return;
  }
  const id = unescapeJsonString(idRaw).trim() || `q_llm_${byId.size + 1}`;
  let options: string[] | undefined;
  if (optionsRaw) {
    try {
      const parsed = JSON.parse(optionsRaw) as unknown;
      if (Array.isArray(parsed)) {
        options = parsed.filter((o): o is string => typeof o === 'string');
      }
    } catch {
      /* options 截断 */
    }
  }
  byId.set(id, {
    id,
    text,
    options: options?.length ? options : undefined,
  });
}
