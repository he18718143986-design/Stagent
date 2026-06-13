/* ------------------------------------------------------------------ */
/*  SkillRegistry — 加载 Matt Pocock `SKILL.md` 原文（保真 single source）*/
/*                                                                     */
/*  目的（SKILLS-ENGINE-INTEGRATION.md §6）：消灭「转写保真度损失」——    */
/*  引擎在 skill 阶段注入 **SKILL.md 原文**，而非把 skill 行为重编码为     */
/*  校验器。registry 记录内容 hash 作为版本，便于 pin 与审计。           */
/*                                                                     */
/*  IO 通过依赖注入（默认 node fs），保持 core 可测、平台中立。          */
/* ------------------------------------------------------------------ */

import * as nodeFs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** 单个 skill 的加载结果。 */
export interface SkillSource {
  /** skill 引用名（= skill 目录名，如 `grill-with-docs`） */
  ref: string;
  /** 所属分类目录名（engineering / productivity / misc / …），若可识别 */
  category?: string;
  /** SKILL.md 绝对路径 */
  skillMdPath: string;
  /** SKILL.md 原文（逐字注入，保真） */
  content: string;
  /** 内容 hash（sha256 前 16 位），用作版本标识 */
  version: string;
  /** 同目录其余 *.md 子文件（如 CONTEXT-FORMAT.md / ADR-FORMAT.md），逐字保留 */
  subFiles: Record<string, string>;
}

/** 文件 IO 端口（默认 node fs；测试可注入内存实现）。 */
export interface SkillFsPort {
  exists(p: string): boolean;
  readFile(p: string): string;
  /** 返回目录下的条目名（不含路径）；不存在时返回空数组 */
  listDir(p: string): string[];
  isDirectory(p: string): boolean;
}

const defaultFsPort: SkillFsPort = {
  exists: (p) => nodeFs.existsSync(p),
  readFile: (p) => nodeFs.readFileSync(p, 'utf-8'),
  listDir: (p) => {
    try {
      return nodeFs.readdirSync(p);
    } catch {
      return [];
    }
  },
  isDirectory: (p) => {
    try {
      return nodeFs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
};

export function hashSkillContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

const SKILL_MD = 'SKILL.md';

export interface SkillRegistryOptions {
  /**
   * skills 根目录。可指向：
   *  - 分类根（含 engineering/ productivity/ misc/ 等子目录），或
   *  - 直接含若干 skill 目录的目录。
   * 两种结构都会被递归识别（最多 2 层）。
   */
  skillsRoot: string;
  fs?: SkillFsPort;
}

/**
 * 扫描并缓存 skillsRoot 下所有 `SKILL.md`。
 * 同名 skill（目录名相同）只保留首个命中。
 */
export class SkillRegistry {
  private readonly fs: SkillFsPort;
  private readonly skillsRoot: string;
  private skills: Map<string, SkillSource> | null = null;

  constructor(opts: SkillRegistryOptions) {
    this.skillsRoot = opts.skillsRoot;
    this.fs = opts.fs ?? defaultFsPort;
  }

  /** 触发（或重新）扫描。返回加载到的 skill 数。 */
  load(): number {
    const map = new Map<string, SkillSource>();
    this.scanInto(map, this.skillsRoot, 0);
    this.skills = map;
    return map.size;
  }

  private ensureLoaded(): Map<string, SkillSource> {
    if (!this.skills) {
      this.load();
    }
    return this.skills as Map<string, SkillSource>;
  }

  /**
   * 递归扫描（最多 2 层）：
   *  - 若某目录直接含 SKILL.md → 注册为一个 skill（ref = 目录名）。
   *    category = 该 skill 目录的父目录名（仅当父目录不是 skillsRoot，即存在分类层时）。
   *  - 否则下钻一层（视为分类目录）。
   */
  private scanInto(map: Map<string, SkillSource>, dir: string, depth: number): void {
    if (depth > 2 || !this.fs.isDirectory(dir)) {
      return;
    }
    const skillMdPath = path.join(dir, SKILL_MD);
    if (this.fs.exists(skillMdPath)) {
      const ref = path.basename(dir);
      // depth>=2 表示存在分类层（root/category/skill）；depth<=1 为扁平布局，无分类
      const category = depth >= 2 ? path.basename(path.dirname(dir)) : undefined;
      if (!map.has(ref)) {
        map.set(ref, this.loadSkillDir(ref, category, dir, skillMdPath));
      }
      return;
    }
    for (const entry of this.fs.listDir(dir)) {
      const child = path.join(dir, entry);
      if (this.fs.isDirectory(child)) {
        this.scanInto(map, child, depth + 1);
      }
    }
  }

  private loadSkillDir(
    ref: string,
    category: string | undefined,
    dir: string,
    skillMdPath: string,
  ): SkillSource {
    const content = this.fs.readFile(skillMdPath);
    const subFiles: Record<string, string> = {};
    for (const entry of this.fs.listDir(dir)) {
      if (entry === SKILL_MD) {
        continue;
      }
      if (entry.toLowerCase().endsWith('.md')) {
        const childPath = path.join(dir, entry);
        if (!this.fs.isDirectory(childPath)) {
          subFiles[entry] = this.fs.readFile(childPath);
        }
      }
    }
    return {
      ref,
      category,
      skillMdPath,
      content,
      version: hashSkillContent(content),
      subFiles,
    };
  }

  /** 是否存在某 skill。 */
  has(ref: string): boolean {
    return this.ensureLoaded().has(ref);
  }

  /** 取 skill 原文；不存在返回 undefined。 */
  get(ref: string): SkillSource | undefined {
    return this.ensureLoaded().get(ref);
  }

  /** 取 skill 原文；不存在抛错（用于必须命中的编排路径）。 */
  require(ref: string): SkillSource {
    const s = this.get(ref);
    if (!s) {
      throw new Error(`skill-not-found:${ref}`);
    }
    return s;
  }

  /** 列出全部已加载 skill 的 ref（排序，稳定）。 */
  list(): string[] {
    return [...this.ensureLoaded().keys()].sort();
  }
}
