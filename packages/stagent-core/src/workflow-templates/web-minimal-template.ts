/** 用户任务是否明显倾向“Web 前端项目”（用于模板化最小工程树约束）。 */
export function webUserIntentHint(userInput: string | undefined): boolean {
  if (!userInput?.trim()) {
    return false;
  }
  return /web|网页|网站|前端|react|vite|next\.?js|nextjs|vue|svelte|spa|浏览器|tailwind|typescript|node\s*api|express/i.test(
    userInput,
  );
}

/** 写入 package.json 的 llm-text 阶段专用：与决策清单格式互斥，供生成器原样写入 workflow JSON。 */
export const WEB_PACKAGE_JSON_IMPL_SYSTEM_PROMPT = `你只负责生成「一个」可写入磁盘的 npm package.json 文件内容。

硬性要求（违反任一条即视为无效输出）：
1) 输出只能是合法 JSON 对象对应的文本：第一个非空白字符必须是 { ，最后一个非空白字符必须是 } 。
2) 禁止输出 Markdown、禁止 ### 标题、禁止 DecisionRecord 四段结构、禁止任何中文/英文说明段落出现在 JSON 外（可选用单独一段 \`\`\`json 围栏仅包裹 JSON；围栏外不得有任何字符）。
3) 必须包含字段：name, version, private, type（建议 "module"）, scripts, dependencies, devDependencies。
4) scripts 必须至少包含：dev, build, preview, test（test 可为占位如 node -e "process.exit(0)"）。
5) dependencies 必须包含 react 与 react-dom；devDependencies 必须包含 vite、typescript、@vitejs/plugin-react。

不要输出除 JSON（及可选 json 围栏）以外的任何内容。`;

/** 拼入 software 生成器大提示；与 {@link webUserIntentHint} 配对使用。 */
export const WEB_MINIMAL_PROJECT_TEMPLATE_TEXT = `
Web Minimal Complete Project Template (Vite + React + TypeScript) — MUST obey when triggers hit:

WHEN the user's task text clearly targets a Web frontend (keywords like web/网页/前端/React/Vite/etc),
THEN your generated workflow MUST produce a runnable project directory tree on disk (NOT only .stagent/generated/*.md).

MANDATORY stages (minimum set; you may add more but these must exist and be correct):

★ HARD GATE — id 必须为 "stage_impl_web_package_json" 的阶段（违反则引擎静态校验失败，不得推送 workflowGenerated）：
- 该阶段的 stages[].outputs **必须且只能**为这一处主输出： [ { "key": "packageJson", "format": "json" } ]（outputs[0].key 必须为字符串 packageJson，禁止额外条目排在它之前）。
- 该阶段 **禁止** isDecisionStage=true（禁止走 approveDecision / 禁止日志里出现 decisionRecord 语义）。
- 该阶段 pauseAfter 推荐 false（若 true，仅允许普通 approve，不得冒充决策阶段）。

1) Project scaffold files — use llm-text with writeOutputToFile to write REAL files under the selected "工作文件夹" (pathBase workspace):
   - stage_impl_web_package_json
     - tool: llm-text
     - id MUST be exactly: "stage_impl_web_package_json"（不得改名；校验器按此 id 执行 HARD GATE）。
     - toolConfig MUST include: writeOutputToFile: "package.json", writePathBase: "workspace"
     - toolConfig.systemPrompt MUST be copied **verbatim character-for-character** from the following block (do NOT prepend §7.5 / DecisionRecord / grill-with-docs text to this stage; this stage is NOT a decision stage):
---
${WEB_PACKAGE_JSON_IMPL_SYSTEM_PROMPT}
---
     - outputs MUST match HARD GATE above（禁止 decisionRecord / implementationCode / sourceCode / text 等作为 outputs[0].key）。
     - 若模型仍输出 Markdown 决策清单，引擎会拒绝写入并报 llm-invalid-output（用户应「重试」该实现阶段）。

   - stage_impl_web_vite_config
     - writeOutputToFile: "vite.config.ts"

   - stage_impl_web_tsconfig
     - writeOutputToFile: "tsconfig.json"
     - generated tsconfig MUST include compilerOptions "strict": true and "esModuleInterop": true (avoids TS1259 on default-import interop in tests; aligns with Stagent layered-borrowing infra guidance).

   - stage_impl_web_index_html
     - writeOutputToFile: "index.html"

   - stage_impl_web_main_tsx
     - writeOutputToFile: "src/main.tsx"

   - stage_impl_web_app_tsx
     - writeOutputToFile: "src/App.tsx"

2) Executable verification — MUST include real code-runner stages running in workspace root:
   - stage_test_run_web_install: command "npm install"
   - stage_test_run_web_build: command "npm run build"
   - stage_test_run_web_test: command "npm test"

All three code-runner stages MUST set pathBase "workspace" + workingDir ".".

FORBIDDEN:
- Only writing .stagent/generated/*.md without writing actual project files.
- Using Python/Flask/etc as the implementation language for this Web template.
- Violating HARD GATE for "stage_impl_web_package_json": wrong outputs[0].key, extra outputs before packageJson, or isDecisionStage=true on that stage.
`;
