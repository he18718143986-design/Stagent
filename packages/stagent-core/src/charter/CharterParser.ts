import type { CharterDocument, CharterRule, CharterRuleType } from './CharterTypes';
import { extractKeywords } from './CharterKeywords';

const SECTION_PATTERNS: Array<{ type: CharterRuleType; pattern: RegExp }> = [
  { type: 'prefer', pattern: /^##\s*(优先|prefer)/i },
  { type: 'avoid', pattern: /^##\s*(避免|avoid)/i },
  { type: 'acceptable', pattern: /^##\s*(可接受|acceptable)/i },
  { type: 'constraint', pattern: /^##\s*(约束|constraints?)/i },
  { type: 'escalate', pattern: /^##\s*(升级|escalat)/i },
];

function emptyDoc(sourcePath: string): CharterDocument {
  return {
    sourcePath,
    prefers: [],
    avoids: [],
    acceptable: [],
    constraints: [],
    escalationRules: [],
  };
}

function pushRule(doc: CharterDocument, type: CharterRuleType, text: string, n: number): void {
  const rule: CharterRule = { n, type, text, keywords: extractKeywords(text) };
  switch (type) {
    case 'prefer':
      doc.prefers.push(rule);
      break;
    case 'avoid':
      doc.avoids.push(rule);
      break;
    case 'acceptable':
      doc.acceptable.push(rule);
      break;
    case 'constraint':
      doc.constraints.push(rule);
      break;
    case 'escalate':
      doc.escalationRules.push(rule);
      break;
    default:
      break;
  }
}

function bucket(type: CharterRuleType, doc: CharterDocument): CharterRule[] {
  switch (type) {
    case 'prefer':
      return doc.prefers;
    case 'avoid':
      return doc.avoids;
    case 'acceptable':
      return doc.acceptable;
    case 'constraint':
      return doc.constraints;
    case 'escalate':
      return doc.escalationRules;
    default:
      return [];
  }
}

/** 解析 Charter markdown（WORKFLOW.md §5.5.2 建议格式）。 */
export function parseCharterMarkdown(sourcePath: string, raw: string): CharterDocument {
  const doc = emptyDoc(sourcePath);
  if (!raw.trim()) {
    return doc;
  }
  let currentType: CharterRuleType | undefined;
  let ruleCounter = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const section = SECTION_PATTERNS.find((s) => s.pattern.test(trimmed));
    if (section) {
      currentType = section.type;
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (!bullet || !currentType) {
      continue;
    }
    ruleCounter += 1;
    pushRule(doc, currentType, bullet[1]!.trim(), ruleCounter);
  }
  return doc;
}

export function allCharterRules(doc: CharterDocument): CharterRule[] {
  return [
    ...doc.prefers,
    ...doc.avoids,
    ...doc.acceptable,
    ...doc.constraints,
    ...doc.escalationRules,
  ];
}

export function constraintAndAvoidRules(doc: CharterDocument): CharterRule[] {
  return [...doc.avoids, ...doc.constraints];
}

export function isCharterEmpty(doc: CharterDocument): boolean {
  return allCharterRules(doc).length === 0;
}

export function ruleCountForType(doc: CharterDocument, type: CharterRuleType): number {
  return bucket(type, doc).length;
}
