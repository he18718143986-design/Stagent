import { describe, expect, it } from 'vitest';
import { featuresOfFile, filesOfFeature, hotspots, impactOf, possiblyRelatedFiles, projectMap } from '../../src/map/map.js';
import { project } from '../../src/projection/projection.js';
import { CURRENT, LineBuilder } from '../helpers/lines.js';

describe('功能文件映射（§4.5）', () => {
  it('扫描入口 → 合并归属（并入）→ 手动纠正（替换）；删除移出映射、重命名迁移归属', () => {
    const b = new LineBuilder()
      .add({ type: 'feature.created', featureId: 'A', name: 'A', origin: 'scan', entryFiles: ['app/a.tsx'] })
      .add({ type: 'feature.created', featureId: 'B', name: 'B', origin: 'new' })
      .add({ type: 'change.files_attributed', changeId: 'c1', by: 'ai', attributions: [{ path: 'src/a.js', featureIds: ['A'] }, { path: 'app/a.tsx', featureIds: ['A'] }] })
      .add({ type: 'change.merged', changeId: 'c1', mergeCommit: 'm1', files: [{ path: 'src/a.js', status: 'added' }, { path: 'app/a.tsx', status: 'modified' }] })
      .add({ type: 'change.files_attributed', changeId: 'c2', by: 'target', attributions: [{ path: 'src/b.js', featureIds: ['B'] }, { path: 'src/a.js', featureIds: ['A', 'B'] }] })
      .add({ type: 'change.merged', changeId: 'c2', mergeCommit: 'm2', files: [{ path: 'src/b.js', status: 'added' }, { path: 'src/a.js', status: 'modified' }] });
    let map = projectMap(b.lines);
    expect(filesOfFeature(map, 'A')).toEqual([
      { path: 'src/a.js', count: 2, lastChangeId: 'c2' },
      { path: 'app/a.tsx', count: 1, lastChangeId: 'c1' },
    ]);
    expect(featuresOfFile(map, 'src/a.js')).toEqual(['A', 'B']);

    b.add({ type: 'feature.files_reassigned', path: 'src/a.js', featureIds: ['A'], by: 'user' })
      .add({ type: 'change.files_attributed', changeId: 'c3', by: 'ai', attributions: [{ path: 'src/a2.js', featureIds: ['A'] }] })
      .add({ type: 'change.merged', changeId: 'c3', mergeCommit: 'm3', files: [{ path: 'src/a2.js', status: 'renamed', from: 'src/a.js' }, { path: 'src/b.js', status: 'deleted' }] });
    map = projectMap(b.lines);
    expect(featuresOfFile(map, 'src/a.js')).toEqual([]);
    expect(filesOfFeature(map, 'A')[0]).toEqual({ path: 'src/a2.js', count: 3, lastChangeId: 'c3' });
    expect(featuresOfFile(map, 'src/b.js')).toEqual([]);
    expect(map.recentChanges.get('A')!.map((c) => c.changeId)).toEqual(['c3', 'c2', 'c1']);
  });

  it('共享热点（≥ 3 个功能）、影响提示与失败定位', () => {
    const b = new LineBuilder()
      .add({ type: 'change.files_attributed', changeId: 'c', by: 'ai', attributions: [{ path: 'src/util.js', featureIds: ['A', 'B', 'C'] }, { path: 'src/b.js', featureIds: ['B'] }] })
      .add({ type: 'change.merged', changeId: 'c', mergeCommit: 'm', files: [{ path: 'src/util.js', status: 'added' }, { path: 'src/b.js', status: 'added' }] });
    const map = projectMap(b.lines);
    expect(hotspots(map)).toEqual([{ path: 'src/util.js', featureIds: ['A', 'B', 'C'] }]);
    const impact = impactOf(map, ['src/b.js', 'src/util.js', 'src/new.js'], ['A']);
    expect(impact.touchedFeatureIds.sort()).toEqual(['A', 'B', 'C']);
    expect(impact.outsideScope).toEqual([
      { path: 'src/b.js', featureIds: ['B'], reason: 'other_feature' },
      { path: 'src/util.js', featureIds: ['A', 'B', 'C'], reason: 'hotspot' },
    ]);
    expect(impactOf(map, ['src/b.js'], []).outsideScope).toEqual([]); // 外部改动没有目标功能：不显示"超出"
    expect(possiblyRelatedFiles(map, 'B', ['src/b.js', 'src/x.js'])).toEqual(['src/b.js']);
  });

  it('Invariant 8：映射事件（含错误的归属）不改变任何证据状态', () => {
    const base = new LineBuilder().feature('A').example('A', 'e1').feature('B').example('B', 'e2').run([['e1', 'passed'], ['e2', 'failed']]);
    const before = project(base.lines, CURRENT);
    base
      .add({ type: 'change.files_attributed', changeId: 'c', by: 'ai', attributions: [{ path: 'src/b.js', featureIds: ['A'] }] })
      .add({ type: 'change.merged', changeId: 'c', mergeCommit: 'm', files: [{ path: 'src/b.js', status: 'modified' }] })
      .add({ type: 'feature.files_reassigned', path: 'src/a.js', featureIds: ['B'], by: 'user' })
      .add({ type: 'feature.created', featureId: 'S', name: 'S', origin: 'scan', entryFiles: ['src/a.js'] });
    const after = project(base.lines, CURRENT);
    const states = (p: typeof before) => p.features.filter((f) => f.featureId !== 'S').map((f) => [f.featureId, f.state, f.examples.map((x) => x.state)]);
    expect(states(after)).toEqual(states(before));
  });
});
