import { describe, expect, it } from 'vitest';
import { extractJson, parseClaimReport } from '../../src/agent/report.js';

describe('AI 回报解析（§8）', () => {
  it('按固定格式解析改了什么、取舍与声称已实现的例子', () => {
    const r = parseClaimReport('## 改了什么\n改了 src/a.js\n\n## 取舍\n无\n\n## 例子\n- e-1: 已实现\n- e-2: 未实现\n- e-9: 已实现\n', ['e-1', 'e-2']);
    expect(r).toMatchObject({ changed: '改了 src/a.js', tradeoffs: '无', claimedExampleIds: ['e-1'], malformed: false });
  });

  it('缺少「改了什么」视为格式异常，原文保留', () => {
    const r = parseClaimReport('我已经全部做完了，测试都过了');
    expect(r.malformed).toBe(true);
    expect(r.text).toBe('我已经全部做完了，测试都过了');
    expect(r.claimedExampleIds).toEqual([]);
  });

  it('extractJson 取最后一个 json 代码块，也能从整段文本里取对象', () => {
    expect(extractJson('先说明\n```json\n{"a":1}\n```\n再改\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('结果是 {"track":"small"} 就这样')).toEqual({ track: 'small' });
    expect(extractJson('没有 JSON')).toBeUndefined();
  });
});
