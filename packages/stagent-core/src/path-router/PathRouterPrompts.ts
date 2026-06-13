import type { StackProfile } from './StackProfile';
import type { WorkflowTemplate } from './WorkflowTemplateTypes';
import { EXPRESS_TEMPLATE_STAGE_SOFT_CAP } from './WorkflowTemplateTypes';

export const EXPRESS_PYTHON_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：express + stackProfile=python（必须与 express 叠加） =====
- **禁止** 生成任何 Node/npm 基础设施阶段：不得出现 stage_init_npm_workspace、stage_npm_install_server、npm init、npm install、jest。
- **禁止** 生成引擎自注入的 Python infra 阶段：不得出现 stage_venv_create、stage_venv_pip_install、stage_venv_import_check（引擎 bootstrap 会幂等注入）。
- 推荐骨架：stage_decide_* → stage_impl_*（writeOutputToFile *.py）→ stage_test_write_* → stage_test_run_*（pytest / python -m pytest）。
- globalConfig.language 写 "python"；globalConfig.stackProfile 写 "python"。
- test_run 命令使用 pytest 或 python -m pytest，pathBase workspace。`;

export const EXPRESS_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：express（workflowTemplate=express 时必须遵守） =====
对齐 WORKFLOW P3：setup → grill-me → tdd → done。

硬性约束：
1. **阶段总数 ≤ ${EXPRESS_TEMPLATE_STAGE_SOFT_CAP}**（理想 3～6）；禁止多切片 DAG（不得出现 2 个以上 stage_decide_<slice> / stage_impl_<slice> 对）。
2. **单垂直切片**：仅实现用户任务中明确描述的行为；禁止「顺手实现」后续切片（如 priority/negatives 等未在需求中出现的 AC）。
3. **禁止**全局架构决策阶段（stage_decide_architecture_overview / stage_zoom_out），除非用户任务**明文**要求多模块或全景扫描。
4. **禁止** to-prd / to-issues 式扩面；不要拆 PRD、不要 10+ stage 全量链。
5. 推荐骨架（可按技术栈微调）：
   - 可选：轻量决策（isDecisionStage，钉死文件名/测试栈/验收一句）
   - stage_test_write_<slice>（RED）
   - stage_impl_<slice>
   - stage_test_run_<slice>（GREEN）
   - 可选：DELIVERY / 文档收尾
6. meta.taskType 选择：
   - 含 pytest/jest/npm test/TDD 链 → **software** 或 **prototype**（二选一，优先 software 若需 Rule 20 测试链）
   - 纯脚本/CLI 无完整产品形态 → **prototype** 或 **other**
   - **不得**因 express 而选 document
7. meta.isGreenfield：按 Path Router 建议写入；绿场时 **不要** 插入 stage_zoom_out。
8. meta.workflowTemplate 必须写 "express"。

===== 类型约束补充：prototype / other（与 express 叠加时更严） =====
- 当 meta.taskType 为 prototype 或 other：**阶段总数 ≤ 6**；禁止多切片扩面。`;

export const GREENFIELD_FULL_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：greenfield_full（workflowTemplate=greenfield_full 时必须遵守） =====
对齐 WORKFLOW P1：setup → grill-with-docs → [prototype] → to-prd → to-issues → tdd×N → [arch]。

- 允许多垂直切片与 PRD/issues 扩面；须遵守 software/prototype 类型约束块。
- meta.workflowTemplate 必须写 "greenfield_full"。`;

export const BROWNFIELD_FULL_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：brownfield_full（workflowTemplate=brownfield_full 时必须遵守） =====
对齐 WORKFLOW P2：含 zoom-out 门禁、多切片 TDD、可选架构决策。

- meta.isGreenfield 应为 false；须含 stage_zoom_out 或等价模块地图（除非类型约束另有说明）。
- meta.workflowTemplate 必须写 "brownfield_full"。`;

export const DEBUG_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：debug（workflowTemplate=debug 时必须遵守） =====
对齐 WORKFLOW P4：复现 → 根因 → 修复 → 回归验证。

- meta.taskType 应为 debug；优先 AFK 可执行链。
- meta.workflowTemplate 必须写 "debug"。`;

export const ARCH_REVIEW_TEMPLATE_CONSTRAINT_TEXT = `
===== 路径模板：arch_review（workflowTemplate=arch_review 时必须遵守） =====
对齐 WORKFLOW P5：improve-codebase-architecture 治理链。

- meta.taskType 应为 improve-architecture；含 zoom-out / seam 分析。
- meta.workflowTemplate 必须写 "arch_review"。`;

const TEMPLATE_BLOCKS: Record<WorkflowTemplate, string> = {
  express: EXPRESS_TEMPLATE_CONSTRAINT_TEXT,
  greenfield_full: GREENFIELD_FULL_TEMPLATE_CONSTRAINT_TEXT,
  brownfield_full: BROWNFIELD_FULL_TEMPLATE_CONSTRAINT_TEXT,
  debug: DEBUG_TEMPLATE_CONSTRAINT_TEXT,
  arch_review: ARCH_REVIEW_TEMPLATE_CONSTRAINT_TEXT,
};

export function workflowTemplateConstraintBlock(
  template: WorkflowTemplate,
  stackProfile?: StackProfile,
): string {
  const base = TEMPLATE_BLOCKS[template];
  if (template === 'express' && stackProfile === 'python') {
    return `${base}\n${EXPRESS_PYTHON_TEMPLATE_CONSTRAINT_TEXT}`;
  }
  return base;
}
