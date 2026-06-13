import {
  DCLOUD_VUE3_VITE_PEER_VITE,
  DCLOUD_VUE3_VITE_PEER_VUE,
  DCLOUD_VUE3_VITE_STACK_VERSION,
} from '../uniappPackagePins';

/** 用户任务是否明显倾向 uni-app（与 Web Vite+React 模板互斥，优先走 uni-app 最小脚手架）。 */
export function uniappUserIntentHint(userInput: string | undefined): boolean {
  if (!userInput?.trim()) {
    return false;
  }
  return /uni-app|uniapp|uni\s*app|@dcloudio|dcloudio|uvue/i.test(userInput);
}

/** 写入 package.json 的 uni-app（Vue3 + Vite + 微信小程序端）llm-text 阶段专用；与决策清单格式互斥。 */
export const UNIAPP_PACKAGE_JSON_IMPL_SYSTEM_PROMPT = `你只负责生成「一个」可写入磁盘的 npm package.json 文件内容（uni-app / Vue3 + Vite，目标端为微信小程序 mp-weixin）。

硬性要求（违反任一条即视为无效输出）：
1) 输出只能是合法 JSON 对象对应的文本：第一个非空白字符必须是 { ，最后一个非空白字符必须是 } 。
2) 禁止输出 Markdown、禁止 ### 标题、禁止 DecisionRecord 四段结构、禁止任何中文/英文说明段落出现在 JSON 外（可选用单独一段 \`\`\`json 围栏仅包裹 JSON；围栏外不得有任何字符）。
3) 必须包含字段：name, version, private, type（建议 "module"）, scripts, dependencies, devDependencies。
4) scripts 必须至少包含：dev:mp-weixin、build:mp-weixin（命令名须与 @dcloudio/uni-cli 常见约定一致，便于 code-runner 执行 npm run build:mp-weixin）。
5) dependencies 必须包含 vue，并包含与 mp-weixin 匹配的 @dcloudio/uni-* 运行时包：**Vue3 须用 \`@dcloudio/uni-app-vue\`**（包名**禁止**写成 \`@dcloudio/uni-app-vue3\`，npm 无此包 → E404）。须含 \`@dcloudio/uni-app\`、\`@dcloudio/uni-app-vue\`、\`@dcloudio/uni-mp-weixin\`；devDependencies 须含 vite、typescript、\`@dcloudio/vite-plugin-uni\`（勿写成纯 React + @vitejs/plugin-react 的 SPA 模板）。
6) **版本号（审阅友好）**：\`@dcloudio/uni-app\`、\`@dcloudio/uni-app-vue\`、\`@dcloudio/uni-mp-weixin\`、\`@dcloudio/vite-plugin-uni\` 宜为同一发布批次；**禁止**臆造形如 \`3.0.0-30804…\`、\`3.0.0-30908…\` 等时间戳式后缀（registry 常无此 tarball → **ETARGET**）。**禁止** \`@dcloudio/vite-plugin-uni\` **^4**（例 **^4.0.0**，npm 无 4 线）。引擎落盘时会强制对齐为 **\`${DCLOUD_VUE3_VITE_STACK_VERSION}\`** 并修正 \`vite\`/\`vue\`（见下条）。**禁止**包名 \`@dcloudio/uni-app-vue3\`。
7) **版本兜底**：落盘时引擎会把 uni-app 栈的 \`@dcloudio/uni-app\` / \`uni-app-vue\` / \`uni-mp-weixin\` / \`vite-plugin-uni\` 强制对齐为 **\`${DCLOUD_VUE3_VITE_STACK_VERSION}\`**，并把 \`vite\`/\`vue\` 对齐为 **\`${DCLOUD_VUE3_VITE_PEER_VITE}\`** / **\`${DCLOUD_VUE3_VITE_PEER_VUE}\`**（若存在对应字段）；你仍应尽量避免幻觉版本以便审阅 diff。**禁止**包名 \`@dcloudio/uni-app-vue3\`（引擎会删并写入 \`uni-app-vue\`）。

不要输出除 JSON（及可选 json 围栏）以外的任何内容。`;

/** vite.config.ts：@dcloudio/vite-plugin-uni 为 CJS 时 Vite+type:module 下 default 可能嵌套；工厂返回 Plugin[] 须展开。生成器/工作流应让 llm-text 阶段贴近此结构。 */
export const UNIAPP_VITE_CONFIG_CANONICAL_SNIPPET = String.raw`import { defineConfig } from 'vite'
import vitePluginUni from '@dcloudio/vite-plugin-uni'

const uni =
  (vitePluginUni as { default?: { default?: (...args: unknown[]) => unknown } }).default?.default ??
  (vitePluginUni as { default?: (...args: unknown[]) => unknown }).default
if (typeof uni !== 'function') {
  throw new Error('@dcloudio/vite-plugin-uni: could not resolve default export')
}

export default defineConfig({
  plugins: [...uni()],
})
`;

/** 拼入 software 生成器大提示；与 {@link uniappUserIntentHint} 配对使用。 */
export const UNIAPP_MINIMAL_PROJECT_TEMPLATE_TEXT = `
Uni-app Minimal Complete Project Template (Vue 3 + Vite + mp-weixin) — MUST obey when triggers hit:

WHEN the user's task text clearly targets **uni-app** (keywords like uni-app/uniapp/@dcloudio/etc; including uni-app targeting 微信小程序),
THEN your generated workflow MUST produce a runnable uni-app project directory tree on disk (NOT only .stagent/generated/*.md).
If the user also mentions a separate React/Vite **Web admin** SPA, treat that SPA as a **different subfolder or later slice**; this block governs the **uni-app** tree only.

MANDATORY stages (minimum set; you may add more but these must exist and be correct):

★ HARD GATE — id 必须为 "stage_impl_uniapp_package_json" 的阶段（违反则引擎静态校验失败，不得推送 workflowGenerated）：
- 该阶段的 stages[].outputs **必须且只能**为这一处主输出： [ { "key": "packageJson", "format": "json" } ]（outputs[0].key 必须为字符串 packageJson，禁止额外条目排在它之前）。
- 该阶段 **禁止** isDecisionStage=true（禁止走 approveDecision / 禁止 decisionRecord 作为 outputs[0].key）。
- 该阶段 pauseAfter 推荐 false（若 true，仅允许普通 approve，不得冒充决策阶段）。

1) Project scaffold files — use llm-text with writeOutputToFile to write REAL files under the selected "工作文件夹" (pathBase workspace):
   - stage_impl_uniapp_package_json
     - tool: llm-text
     - id MUST be exactly: "stage_impl_uniapp_package_json"（不得改名；校验器按此 id 执行 HARD GATE）。
     - toolConfig MUST include: writeOutputToFile: "package.json", writePathBase: "workspace"
     - toolConfig.systemPrompt MUST be copied **verbatim character-for-character** from the following block (do NOT prepend §7.5 / DecisionRecord / grill-with-docs text to this stage; this stage is NOT a decision stage):
---
${UNIAPP_PACKAGE_JSON_IMPL_SYSTEM_PROMPT}
---
     - outputs MUST match HARD GATE above（禁止 decisionRecord / implementationCode / sourceCode / text 等作为 outputs[0].key）。
     - 若模型仍输出 Markdown 决策清单，引擎会拒绝写入并报 llm-invalid-output（用户应「重试」该实现阶段）。

   - stage_impl_uniapp_vite_config — writeOutputToFile: "vite.config.ts"
     - systemPrompt SHOULD require: use \`@dcloudio/vite-plugin-uni\`; **plugins 必须为 \`[...factory()]\`**（工厂返回插件数组）。若 \`import uni from '...'\` 在运行时不是函数，须按 CJS 互操作解包 \`.default?.default ?? .default\`。**推荐**与下列 canonical 逻辑一致（可改 import 路径以外的格式，但互操作与 spread 不可省）：
---
${UNIAPP_VITE_CONFIG_CANONICAL_SNIPPET}
---
   - stage_impl_uniapp_tsconfig — writeOutputToFile: "tsconfig.json"
     - MUST include "strict": true and "esModuleInterop": true under compilerOptions (Stagent infra guidance for node/ts-node tests and CJS interop).
   - stage_impl_uniapp_index_html — writeOutputToFile: "index.html"
   - stage_impl_uniapp_main_ts — writeOutputToFile: "src/main.ts"
   - stage_impl_uniapp_app_vue — writeOutputToFile: "src/App.vue"
   - stage_impl_uniapp_manifest — writeOutputToFile: "src/manifest.json"
   - stage_impl_uniapp_pages_json — writeOutputToFile: "src/pages.json"
   - stage_impl_uniapp_index_page — writeOutputToFile: "src/pages/index/index.vue"

2) Executable verification — MUST include real code-runner stages in workspace root:
   - stage_test_run_uniapp_install: command "npm install"
   - stage_test_run_uniapp_build_mp_weixin: command "npm run build:mp-weixin"

Both code-runner stages MUST set pathBase "workspace" + workingDir ".".

FORBIDDEN:
- Only writing .stagent/generated/*.md without writing actual project files.
- Reusing the **Web (React+Vite SPA)** minimal template package.json shape for this uni-app block (wrong dependencies/plugins).
- Fictitious @dcloudio semver majors (e.g. \`@dcloudio/vite-plugin-uni@^4.0.0\`) that do not exist on npm and break \`npm install\`.
- \`vite.config.ts\` 写成 \`plugins: [uni()]\` 且 \`uni\` 实际非函数（未解包 CJS default）或写成 \`plugins: [uni()]\` 而 \`uni()\` 返回数组却未展开（应为 \`[...uni()]\`）。
- Violating HARD GATE for "stage_impl_uniapp_package_json": wrong outputs[0].key, extra outputs before packageJson, or isDecisionStage=true on that stage.
`;
