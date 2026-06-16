import { extractJsonObject } from '../JsonExtract';
import {
  type DecisionArtifactsV1,
  isDecisionArtifactsV1,
} from './decisionArtifactsSchema';
import { validateBehaviorSpecForSemantic } from './behaviorSpecSchema';

const ARTIFACTS_MARKER_RE = /<!--\s*decisionArtifacts:json\s*-->/i;

export const DECISION_ARTIFACTS_PROMPT_SUFFIX = `

【决策机读 sidecar（decisionArtifacts）】
在 DecisionRecord Markdown 正文之后，另起一行输出标记行：
<!-- decisionArtifacts:json -->
随后输出**唯一**一个 JSON 对象（不要用 markdown 围栏），结构：
{"version":1,"files":[{"key":"configContent","path":"config.yaml","format":"yaml","content":"..."}],"modules":[{"name":"indicators","exports":["compute"]}],"dependencies":["pytest","numpy","pandas"],"testStack":"pytest"}
- files[].key 供下游 file-write 的 sourceOutputKey 引用；content 为完整文件正文。
- modules[]：全项目模块接口契约（name=Python 包名/切片语义名，exports=允许 test/impl 引用的公开符号）。
- dependencies[]：允许 impl/fix 使用的第三方包根名（如 numpy、pandas）；未声明的包不得在代码中 import。
- 全局架构决策须列出**全部**切片模块的 modules[]；若无额外落盘文件，files 可为 []。
- DecisionRecord 正文仍禁止代码块；JSON sidecar 不受此限。`;

/** 切片 decide：本模块 modules[] 单条（可细化全局表）。 */
export const SLICE_MODULE_CONTRACT_SUFFIX = `

【本切片模块契约（decisionArtifacts.modules）】
sidecar JSON 的 modules 须含**恰好一条**：{"name":"<本切片语义名>","exports":["公开符号1",...]}。
- exports 为 test_write / impl 唯一允许的 from <name> import <symbol> 集合；禁止发明未列符号。
- exports **只能是本切片自身**在该模块顶层 def/class 定义的公开符号。**严禁**列入：
  ① 其它切片的符号（如在 pipeline 契约里列 store 的方法 add/update/list_all、models 的 validate_task）；
  ② 任何模块名/包名（如 store、statemachine、pipeline 自身——模块名不是可 import 的符号）；
  ③ 导入的占位/标准库别名（如 DictReader=csv.DictReader、import 进来的类型构造器）。
  本切片只需把**别的切片**的能力当依赖调用（如 pipeline 接收 store 实例为参数），不得把它们列进本切片 exports。
- exports 须**完整**——列出本切片所有公开导出，**勿漏**（漏声明会使 impl 正确导出的符号被 export-extra 判红）。
  按切片语义把约定的标准符号全部列入，例如：
  · 状态机：ALLOWED_TRANSITIONS、can_transition、apply_transition、自定义异常（如 InvalidTransition）全列；
  · 数据管道：import_tasks_from_csv、summarize 等公开函数全列；
  · 仓储：公开类（如 TaskStore）——其方法由类承载，不单列为模块级 export。
  与全局架构 modules[] 的本切片条目对照：凡 global 已为本切片声明的公开符号，本 sidecar 不得遗漏。
- 可与全局架构 modules[] 不一致时以本切片 sidecar 为准，但**不得少于** global 已声明的本切片导出（只可补充，不可遗漏）。`;

/** signals 等切片：decide 须产出 behaviorSpec 机读行为契约。 */
export const BEHAVIOR_SPEC_SLICE_SUFFIX = `

【本切片行为规格（decisionArtifacts.behaviorSpec）】
sidecar JSON 须含 behaviorSpec 对象（与 modules[] 并列），结构示例：
{"version":1,"modules":[{"name":"signals","exports":["generate_bear_signal","generate_bull_signal"]}],"behaviorSpec":{"module":"signals","functions":[{"name":"generate_bear_signal","returns":"Signal | None","when_non_null":"all","conditions":[{"id":"ma_convergence","desc":"MA5..MA9 spread < spread_threshold (strict <)"},{"id":"cci_cross_down","desc":"CCI[-2] >= cci_cross_band AND CCI[-1] < -cci_cross_band"}]}],"edge_rules":["Threshold comparisons use strict < unless noted.","Fixture helpers _set_ideal_* MUST run before boundary column overrides."],"fixture_hints":["typical_bear_indicators_ok must satisfy all condition ids for generate_bear_signal."]}}
- functions[].conditions[].id 为稳定标识，test_write / impl / fix 全链路引用。
- when_non_null：all=AND 链（默认），any=OR 链。
- edge_rules：跨用例边界纪律（比较符、helper 顺序、禁止 export 的占位符）。
- DecisionRecord 散文保留人读说明；与 behaviorSpec 冲突时以 behaviorSpec 为准。`;

/**
 * 从决策阶段 LLM 输出提取 decisionArtifacts JSON（marker 后或文末 JSON 对象）。
 */
export function parseDecisionArtifactsFromText(
  text: string,
  options?: { semantic?: string },
): {
  artifacts: DecisionArtifactsV1 | null;
  markdownBody: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return { artifacts: null, markdownBody: '', warnings: ['empty decision output'] };
  }

  const markerIdx = trimmed.search(ARTIFACTS_MARKER_RE);
  let markdownBody = trimmed;
  let jsonCandidate = '';

  if (markerIdx >= 0) {
    markdownBody = trimmed.slice(0, markerIdx).trim();
    jsonCandidate = trimmed.slice(markerIdx).replace(ARTIFACTS_MARKER_RE, '').trim();
  } else {
    const extracted = extractJsonObject(trimmed);
    if (extracted) {
      const jsonStart = trimmed.indexOf(extracted);
      if (jsonStart > 0) {
        markdownBody = trimmed.slice(0, jsonStart).trim();
        jsonCandidate = extracted;
      }
    }
  }

  if (!jsonCandidate) {
    return { artifacts: null, markdownBody, warnings };
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (!isDecisionArtifactsV1(parsed)) {
      warnings.push('decisionArtifacts JSON 结构无效');
      return { artifacts: null, markdownBody, warnings };
    }
    if (options?.semantic) {
      const mod = parsed.modules?.find((m) => m.name === options.semantic);
      for (const v of validateBehaviorSpecForSemantic(
        options.semantic,
        parsed.behaviorSpec,
        mod?.exports,
      )) {
        warnings.push(v.message);
      }
    }
    return { artifacts: parsed, markdownBody, warnings };
  } catch (e) {
    warnings.push(`decisionArtifacts JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`);
    return { artifacts: null, markdownBody, warnings };
  }
}
