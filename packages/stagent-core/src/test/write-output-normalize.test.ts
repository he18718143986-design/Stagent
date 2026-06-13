import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  DCLOUD_VUE3_VITE_PEER_VITE,
  DCLOUD_VUE3_VITE_PEER_VUE,
  DCLOUD_VUE3_VITE_STACK_VERSION,
} from '../uniappPackagePins';
import { normalizeLlmOutputForWritePath } from '../WriteOutputNormalize';

test('normalizeLlmOutputForWritePath accepts fenced JSON for package.json', () => {
  const raw = '```json\n{"name":"x","version":"1.0.0"}\n```';
  const r = normalizeLlmOutputForWritePath('package.json', raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    const o = JSON.parse(r.content) as { name: string };
    assert.equal(o.name, 'x');
  }
});

test('normalizeLlmOutputForWritePath rejects Markdown prose for package.json', () => {
  const raw = `### 职责边界\n本决策的职责是生成 package.json\n{"name":"bad"`;
  const r = normalizeLlmOutputForWritePath('package.json', raw);
  assert.equal(r.ok, false);
});

test('normalizeLlmOutputForWritePath extracts embedded JSON object from mixed text', () => {
  const raw = '说明文字\n{"name":"y","version":"2.0.0"}\n尾部';
  const r = normalizeLlmOutputForWritePath('package.json', raw);
  assert.equal(r.ok, true);
  if (r.ok) {
    const o = JSON.parse(r.content) as { name: string };
    assert.equal(o.name, 'y');
  }
});

test('normalizeLlmOutputForWritePath passes through non-JSON paths', () => {
  const r = normalizeLlmOutputForWritePath('src/App.tsx', 'export default function App() { return null }');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.content.includes('export default'));
  }
});

test('normalizeLlmOutputForWritePath pins hallucinated @dcloudio uni-app stack in package.json', () => {
  const raw = JSON.stringify({
    name: 'x',
    version: '1.0.0',
    private: true,
    dependencies: {
      vue: '^3.4.0',
      '@dcloudio/uni-app': '3.0.0-3090820240930001',
      '@dcloudio/uni-app-vue': '3.0.0-3090820240930001',
      '@dcloudio/uni-mp-weixin': '3.0.0-3090820240930001',
    },
    devDependencies: {
      vite: '^4.0.0',
      '@dcloudio/vite-plugin-uni': '3.0.0-3090820240930001',
    },
  });
  const r = normalizeLlmOutputForWritePath('miniapp/package.json', raw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const o = JSON.parse(r.content) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(o.dependencies['@dcloudio/uni-app'], DCLOUD_VUE3_VITE_STACK_VERSION);
  assert.equal(o.dependencies['@dcloudio/uni-app-vue'], DCLOUD_VUE3_VITE_STACK_VERSION);
  assert.equal(o.dependencies['@dcloudio/uni-mp-weixin'], DCLOUD_VUE3_VITE_STACK_VERSION);
  assert.equal(o.devDependencies['@dcloudio/vite-plugin-uni'], DCLOUD_VUE3_VITE_STACK_VERSION);
  assert.equal(o.devDependencies['vite'], DCLOUD_VUE3_VITE_PEER_VITE);
  assert.equal(o.dependencies['vue'], DCLOUD_VUE3_VITE_PEER_VUE);
});

test('normalizeLlmOutputForWritePath rewrites uni-app-vue3 and does not touch plain Node package.json', () => {
  const uniRaw = JSON.stringify({
    name: 'u',
    dependencies: {
      '@dcloudio/uni-app': '3.0.0-fake',
      '@dcloudio/uni-app-vue3': '3.0.0-fake',
    },
    devDependencies: { '@dcloudio/vite-plugin-uni': '3.0.0-fake' },
  });
  const r = normalizeLlmOutputForWritePath('package.json', uniRaw);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const o = JSON.parse(r.content) as { dependencies: Record<string, string> };
  assert.equal(o.dependencies['@dcloudio/uni-app-vue3'], undefined);
  assert.equal(o.dependencies['@dcloudio/uni-app-vue'], DCLOUD_VUE3_VITE_STACK_VERSION);

  const plain = JSON.stringify({ name: 'srv', dependencies: { express: '^4.19.0' } });
  const r2 = normalizeLlmOutputForWritePath('package.json', plain);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const o2 = JSON.parse(r2.content) as { dependencies: Record<string, string> };
  assert.equal(o2.dependencies.express, '^4.19.0');
});
