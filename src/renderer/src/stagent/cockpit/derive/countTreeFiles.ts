import type { FsNode } from '../../../pages/FileTree'

export interface TreeCount {
  files: number
  dirs: number
}

/** 递归统计文件树里的文件数与文件夹数(不含根)。纯函数,便于单测。 */
export function countTreeFiles(node: FsNode | null | undefined): TreeCount {
  if (!node) {
    return { files: 0, dirs: 0 }
  }
  let files = 0
  let dirs = 0
  const walk = (children: FsNode[] | undefined): void => {
    if (!children) {
      return
    }
    for (const c of children) {
      if (c.type === 'dir') {
        dirs += 1
        walk(c.children)
      } else {
        files += 1
      }
    }
  }
  // 传入的若是根目录节点,从其 children 开始计;若直接传 children 容器同理。
  walk(node.children)
  return { files, dirs }
}
