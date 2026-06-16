import { describe, it, expect } from 'vitest'
import { countTreeFiles } from '../stagent/cockpit/derive/countTreeFiles'
import type { FsNode } from '../pages/FileTree'

const f = (name: string): FsNode => ({ name, path: '/r/' + name, type: 'file' })
const d = (name: string, children: FsNode[]): FsNode => ({ name, path: '/r/' + name, type: 'dir', children })

describe('countTreeFiles', () => {
  it('returns zero for null/empty', () => {
    expect(countTreeFiles(null)).toEqual({ files: 0, dirs: 0 })
    expect(countTreeFiles({ name: 'r', path: '/r', type: 'dir', children: [] })).toEqual({ files: 0, dirs: 0 })
  })

  it('counts nested files and dirs (excluding root)', () => {
    const root: FsNode = d('root', [
      f('a.py'),
      f('b.txt'),
      d('src', [f('c.py'), d('inner', [f('d.py')])]),
    ])
    expect(countTreeFiles(root)).toEqual({ files: 4, dirs: 2 })
  })
})
