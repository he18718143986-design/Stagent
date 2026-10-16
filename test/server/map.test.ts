/**
 * 验收 #22：系统地图——合并 A、B、A 后地图列出各自的文件；以 A 为目标却改了 B 的文件 →「超出本功能的改动」；
 * 改坏 B → B 的「可能相关的改动文件」；删除、重命名后映射随之更新。
 */
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeProjectFile } from '../../src/agent/scripted.js';
import type { ChangeView, ChangesProjection } from '../../src/changes/changes.js';
import type { ChangeDiffView, MapView } from '../../src/server/flows/map-flow.js';
import { serverProject } from '../helpers/server.js';

const READS = (file: string, expected: number) =>
  `const m = await import(process.env.STAGENT_PROJECT_ROOT + '/${file}?' + Date.now()); process.exit(m.v === ${expected} ? 0 : 1);\n`;

describe('#22 系统地图', () => {
  it('A、B、A 三次合并 → 地图；超出本功能的改动；失败定位；删除与重命名', async () => {
    const p = await serverProject();
    const active = async () => (await p.call<ChangesProjection>('GET', '/api/changes')).body.active!;
    const mergeActive = async () => {
      await p.runAll();
      const c = await active();
      const r = await p.call('POST', `/api/changes/${c.changeId}/merge`);
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    };

    // 改动 1：新功能 A（src/a.js）
    await writeProjectFile(p.root, 'src/a.js', 'export const v = 1;\n');
    const a = await p.lock('A', '.stagent/checks/a.mjs', READS('src/a.js', 1));
    await mergeActive();
    // 改动 2：新功能 B（src/b.js）
    await writeProjectFile(p.root, 'src/b.js', 'export const v = 2;\n');
    const b = await p.lock('B', '.stagent/checks/b.mjs', READS('src/b.js', 2));
    await mergeActive();
    // 改动 3：给 A 补一个文件（以 A 为目标的小改动）
    await p.service.createChange({ description: '给 A 加工具函数', track: 'small', targetFeatureIds: [a.featureId] });
    await writeProjectFile(p.root, 'src/a-util.js', 'export const helper = 1;\n');
    await p.call('POST', '/api/map/files', { path: 'src/a-util.js', featureIds: [a.featureId] }); // 先手动归属，下面校验它被采用
    await mergeActive();

    let map = (await p.call<MapView>('GET', '/api/map')).body;
    const filesOf = (id: string) => map.features.find((f) => f.featureId === id)!.files.map((f) => f.path).sort();
    expect(filesOf(a.featureId)).toEqual(['src/a-util.js', 'src/a.js']);
    expect(filesOf(b.featureId)).toEqual(['src/b.js']);
    expect(map.note).toMatch(/不是代码依赖分析/);
    expect((await p.call<{ features: { name: string }[] }>('GET', '/api/map/files?path=src/b.js')).body.features.map((f) => f.name)).toEqual(['B']);

    // 改动 4：以 A 为目标，却改了 B 的文件（并把 B 改坏）
    const c4 = await p.service.createChange({ description: '调整 A', track: 'small', targetFeatureIds: [a.featureId] });
    await writeProjectFile(p.root, 'src/b.js', 'export const v = 99;\n');
    await p.runAll();
    let diff = (await p.call<ChangeDiffView>('GET', `/api/changes/${c4.changeId}/diff`)).body;
    expect(diff.outsideScope).toEqual([{ path: 'src/b.js', reason: 'other_feature', features: [{ featureId: b.featureId, name: 'B' }] }]);
    expect(diff.touchedFeatures.map((f) => f.name)).toEqual(['B']);
    expect(diff.failureLocations).toEqual([{ featureId: b.featureId, name: 'B', files: ['src/b.js'] }]);
    expect((await p.call<ChangeView>('GET', `/api/changes/${c4.changeId}`)).body.phase).toBe('blocked');

    // 修好后：重命名 A 的文件、删除 B 的文件以外的工具文件，合并后映射随之更新。
    await writeProjectFile(p.root, 'src/b.js', 'export const v = 2;\n');
    await rename(join(p.root, 'src/a-util.js'), join(p.root, 'src/a-helpers.js'));
    await rm(join(p.root, 'README.md'));
    await mergeActive();
    map = (await p.call<MapView>('GET', '/api/map')).body;
    expect(filesOf(a.featureId)).toEqual(['src/a-helpers.js', 'src/a.js']);
    diff = (await p.call<ChangeDiffView>('GET', `/api/changes/${c4.changeId}/diff`)).body;
    expect(diff.files.find((f) => f.path === 'src/a-helpers.js')).toMatchObject({ status: 'renamed', from: 'src/a-util.js' });
  });

  it('手动修改本改动的文件归属（source:user），之后的自动归属不覆盖', async () => {
    const p = await serverProject();
    const a = await p.lock('A', '.stagent/checks/a.mjs', 'process.exit(0);\n');
    await writeProjectFile(p.root, 'src/x.js', 'export const x = 1;\n');
    const put = await p.call<{ path: string; source: string }[]>('PUT', `/api/changes/${a.changeId}/attributions`, { attributions: [{ path: 'src/x.js', featureIds: [] }] });
    expect(put.body).toEqual([{ path: 'src/x.js', featureIds: [], source: 'user' }]);
    await p.runAll();
    const diff = (await p.call<ChangeDiffView>('GET', `/api/changes/${a.changeId}/diff`)).body;
    expect(diff.attributions.find((x) => x.path === 'src/x.js')).toEqual({ path: 'src/x.js', featureIds: [], source: 'user' });
  });
});
