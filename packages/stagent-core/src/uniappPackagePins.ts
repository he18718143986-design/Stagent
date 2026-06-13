/**
 * uni-app（Vue3 + Vite + @dcloudio/vite-plugin-uni）在 npm 上的版本号易被 LLM 幻觉；
 * 此处为经 `npm install` 验证的一条发布线，供落盘 package.json 时强制对齐。
 * 升级栈时：改此常量 + 同步 `npm view` peer（vite / vue）后跑集成验证。
 */
export const DCLOUD_VUE3_VITE_STACK_VERSION = '3.0.0-5000720260410001' as const;

/** 与 {@link DCLOUD_VUE3_VITE_STACK_VERSION} 配套，满足 @dcloudio/vite-plugin-uni 的 peerDependencies.vite */
export const DCLOUD_VUE3_VITE_PEER_VITE = '5.2.8' as const;

/** 与当前 vite-plugin-uni 依赖的 @vue/* 小版本线一致 */
export const DCLOUD_VUE3_VITE_PEER_VUE = '3.4.21' as const;

function isPlainDepRecord(x: unknown): x is Record<string, string> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function ensureDepSections(pkg: Record<string, unknown>): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  if (!isPlainDepRecord(pkg.dependencies)) {
    pkg.dependencies = {};
  }
  if (!isPlainDepRecord(pkg.devDependencies)) {
    pkg.devDependencies = {};
  }
  return {
    dependencies: pkg.dependencies as Record<string, string>,
    devDependencies: pkg.devDependencies as Record<string, string>,
  };
}

/**
 * 若 package.json 表现为 uni-app Vue3+Vite 脚手架，则将易幻觉的 @dcloudio 栈版本钉到 {@link DCLOUD_VUE3_VITE_STACK_VERSION}，
 * 并修正错误包名、补全缺失的同栈依赖；不影响普通 Node/React 项目的 package.json。
 */
export function applyDcloudVue3VitePinsIfUniAppScaffold(pkg: Record<string, unknown>): void {
  const depsRaw = pkg.dependencies;
  const devRaw = pkg.devDependencies;
  const deps = isPlainDepRecord(depsRaw) ? depsRaw : undefined;
  const devDeps = isPlainDepRecord(devRaw) ? devRaw : undefined;

  const hasUniApp = !!(deps && deps['@dcloudio/uni-app']);
  const hasVitePluginUni = !!(devDeps && devDeps['@dcloudio/vite-plugin-uni']);
  if (!hasUniApp && !hasVitePluginUni) {
    return;
  }

  const { dependencies: d, devDependencies: dd } = ensureDepSections(pkg);
  const pin = DCLOUD_VUE3_VITE_STACK_VERSION;

  if (d['@dcloudio/uni-app-vue3']) {
    delete d['@dcloudio/uni-app-vue3'];
  }

  if (hasUniApp) {
    d['@dcloudio/uni-app'] = pin;
    d['@dcloudio/uni-app-vue'] = pin;
    d['@dcloudio/uni-mp-weixin'] = pin;
  }

  if (hasVitePluginUni || hasUniApp) {
    dd['@dcloudio/vite-plugin-uni'] = pin;
    dd['vite'] = DCLOUD_VUE3_VITE_PEER_VITE;
  }

  if (hasUniApp && Object.prototype.hasOwnProperty.call(d, 'vue')) {
    d['vue'] = DCLOUD_VUE3_VITE_PEER_VUE;
  }
}
