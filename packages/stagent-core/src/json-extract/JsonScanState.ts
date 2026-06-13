export interface JsonCandidate {
  text: string;
  opener: '{' | '[';
}

export interface JsonScanState {
  start: number;
  opener: '{' | '[' | undefined;
  depth: number;
  inString: boolean;
  escaped: boolean;
}

export function createJsonScanState(): JsonScanState {
  return { start: -1, opener: undefined, depth: 0, inString: false, escaped: false };
}

export function stepJsonScan(state: JsonScanState, ch: string, index: number): JsonCandidate | undefined {
  if (state.inString) {
    if (state.escaped) {
      state.escaped = false;
    } else if (ch === '\\') {
      state.escaped = true;
    } else if (ch === '"') {
      state.inString = false;
    }
    return undefined;
  }
  if (ch === '"') {
    state.inString = true;
    return undefined;
  }
  if (ch === '{' || ch === '[') {
    if (state.depth === 0) {
      state.start = index;
      state.opener = ch;
    }
    state.depth++;
    return undefined;
  }
  if (ch === '}' || ch === ']') {
    state.depth--;
    if (state.depth === 0 && state.start !== -1 && state.opener) {
      const candidate: JsonCandidate = {
        text: '',
        opener: state.opener,
      };
      state.start = -1;
      state.opener = undefined;
      return candidate;
    }
  }
  return undefined;
}

export function scanBalancedJsonFromIndex(
  text: string,
  startIdx: number,
): { inString: boolean; depth: number; escaped: boolean } {
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
  return { inString, depth, escaped };
}
