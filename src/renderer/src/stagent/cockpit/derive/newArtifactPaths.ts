import type { StageArtifactHint } from '@stagent/core'

/** 由各阶段产物提示汇出"新文件"路径集(含完整路径与 basename),供文件树高亮。纯函数。 */
export function newArtifactPaths(artifacts: Record<string, StageArtifactHint[]>): Set<string> {
  const set = new Set<string>()
  for (const hints of Object.values(artifacts)) {
    for (const h of hints) {
      if (h.filePath) {
        set.add(h.filePath)
        const base = h.filePath.split(/[\\/]/).pop()
        if (base) {
          set.add(base)
        }
      }
    }
  }
  return set
}
