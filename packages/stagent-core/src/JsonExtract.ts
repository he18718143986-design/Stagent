interface JsonCandidate {
  text: string;
  /** 顶层起始字符：'{' 表示对象，'[' 表示数组 */
  opener: '{' | '[';
}

/** 扫描出顶层平衡的 JSON 片段（对象 `{...}` 与数组 `[...]`），忽略字符串内的括号。 */
function collectBalancedJsonCandidates(text: string): JsonCandidate[] {
  const out: JsonCandidate[] = [];
  let start = -1;
  let opener: '{' | '[' | undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) {
        start = i;
        opener = ch;
      }
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start !== -1 && opener) {
        out.push({ text: text.slice(start, i + 1), opener });
        start = -1;
        opener = undefined;
      }
      continue;
    }
  }

  return out;
}

function pickFirstValidJson(
  text: string,
  accept: (c: JsonCandidate) => boolean,
): string | undefined {
  for (const candidate of collectBalancedJsonCandidates(text)) {
    if (!accept(candidate)) {
      continue;
    }
    try {
      JSON.parse(candidate.text);
      return candidate.text;
    } catch {
      // keep searching for next valid candidate
    }
  }
  return undefined;
}

function stripFencesAndPick(
  raw: string,
  accept: (c: JsonCandidate) => boolean,
): string | undefined {
  const fenced = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)).map((m) => m[1].trim());
  for (const block of fenced) {
    const parsed = pickFirstValidJson(block, accept);
    if (parsed) {
      return parsed;
    }
  }
  return pickFirstValidJson(raw.trim(), accept);
}

/** 提取首个合法 JSON 对象（`{...}`）。剥离 markdown 围栏，忽略前后散文。 */
export function extractJsonObject(raw: string): string | undefined {
  return stripFencesAndPick(raw, (c) => c.opener === '{');
}

/** 提取首个合法 JSON 值（对象或数组）。用于 PatchInstruction[] 等数组输出。 */
export function extractJsonValue(raw: string): string | undefined {
  return stripFencesAndPick(raw, () => true);
}

/**
 * 粗判 JSON 是否被截断（#1）：剥离围栏后，从首个 `{`/`[` 起扫描括号深度，
 * 若到文本结束仍未归零（或停在字符串内），视为截断 → 触发「续写」而非「重写」。
 */
export function isLikelyTruncatedJson(raw: string): boolean {
  const fenced = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)).map((m) => m[1].trim());
  const text = (fenced.length > 0 ? fenced[fenced.length - 1] : raw).trim();
  const startIdx = text.search(/[{[]/);
  if (startIdx === -1) {
    return false; // 根本没有 JSON 起始 → 不是截断，属于格式错误
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return inString || depth > 0;
}
