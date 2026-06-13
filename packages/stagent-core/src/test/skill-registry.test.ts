import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { SkillRegistry, hashSkillContent, type SkillFsPort } from '../SkillRegistry';

/** 内存 fs：由 files 映射推导目录结构。 */
function makeFakeFs(files: Record<string, string>): SkillFsPort {
  const norm = (p: string) => p.replace(/\/+$/, '');
  const fileSet = new Set(Object.keys(files).map(norm));
  const dirSet = new Set<string>();
  for (const f of fileSet) {
    let d = path.dirname(f);
    while (d && d !== path.dirname(d)) {
      dirSet.add(norm(d));
      d = path.dirname(d);
    }
  }
  return {
    exists: (p) => fileSet.has(norm(p)) || dirSet.has(norm(p)),
    readFile: (p) => {
      const v = files[norm(p)] ?? files[p];
      if (v === undefined) {
        throw new Error(`ENOENT:${p}`);
      }
      return v;
    },
    isDirectory: (p) => dirSet.has(norm(p)),
    listDir: (p) => {
      const base = norm(p);
      const children = new Set<string>();
      for (const f of [...fileSet, ...dirSet]) {
        if (path.dirname(f) === base) {
          children.add(path.basename(f));
        }
      }
      return [...children];
    },
  };
}

const ROOT = '/skills';

function fixture(): Record<string, string> {
  return {
    [`${ROOT}/engineering/grill-with-docs/SKILL.md`]: '# grill-with-docs\nstress-test the plan',
    [`${ROOT}/engineering/grill-with-docs/CONTEXT-FORMAT.md`]: '# CONTEXT format',
    [`${ROOT}/engineering/grill-with-docs/ADR-FORMAT.md`]: '# ADR format',
    [`${ROOT}/engineering/tdd/SKILL.md`]: '# tdd\nred-green-refactor',
    [`${ROOT}/productivity/grill-me/SKILL.md`]: '# grill-me\nlightweight grilling',
  };
}

test('扫描分类目录并按 skill 目录名注册', () => {
  const reg = new SkillRegistry({ skillsRoot: ROOT, fs: makeFakeFs(fixture()) });
  const n = reg.load();
  assert.equal(n, 3);
  assert.deepEqual(reg.list(), ['grill-me', 'grill-with-docs', 'tdd']);
  assert.equal(reg.has('grill-with-docs'), true);
  assert.equal(reg.has('nope'), false);
});

test('加载 SKILL.md 原文 + 版本 hash + 同目录 md 子文件', () => {
  const files = fixture();
  const reg = new SkillRegistry({ skillsRoot: ROOT, fs: makeFakeFs(files) });
  const skill = reg.require('grill-with-docs');
  assert.equal(skill.ref, 'grill-with-docs');
  assert.equal(skill.category, 'engineering');
  assert.equal(skill.content, files[`${ROOT}/engineering/grill-with-docs/SKILL.md`]);
  assert.equal(skill.version, hashSkillContent(skill.content));
  assert.deepEqual(Object.keys(skill.subFiles).sort(), ['ADR-FORMAT.md', 'CONTEXT-FORMAT.md']);
});

test('require 未命中抛错', () => {
  const reg = new SkillRegistry({ skillsRoot: ROOT, fs: makeFakeFs(fixture()) });
  assert.throws(() => reg.require('does-not-exist'), /skill-not-found:does-not-exist/);
});

test('支持 skillsRoot 直接含 skill 目录（无分类层）', () => {
  const files = {
    '/flat/grill-me/SKILL.md': '# grill-me',
    '/flat/tdd/SKILL.md': '# tdd',
  };
  const reg = new SkillRegistry({ skillsRoot: '/flat', fs: makeFakeFs(files) });
  assert.equal(reg.load(), 2);
  assert.equal(reg.get('grill-me')?.category, undefined);
});

test('版本 hash 随内容变化', () => {
  assert.notEqual(hashSkillContent('a'), hashSkillContent('b'));
  assert.equal(hashSkillContent('same'), hashSkillContent('same'));
});
