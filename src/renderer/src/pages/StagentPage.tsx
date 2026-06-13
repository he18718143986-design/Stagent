/* ------------------------------------------------------------------ */
/*  StagentPage — 决策式工作流的渲染层 UI                              */
/*                                                                     */
/*  通过 window.autoAI.stagent 驱动主进程的 @stagent/core 引擎，        */
/*  并消费 stagent:event 推送的 BackendMessage（见 useStagentEngine）。  */
/*  三阶段状态机：input(输入/润色/澄清) → confirm(确认计划) → execution。 */
/* ------------------------------------------------------------------ */

import React, { useEffect, useMemo, useState } from 'react'
import type { Question, StageStatus } from '@stagent/core'
import { useStagentEngine, type StagentLlmConfig } from '../stagent/useStagentEngine'
import { QualityReportPanel } from '../stagent/QualityReportPanel'
import { groupModels } from '../stagent/model-grouping'
import TaskTree from './TaskTree'
import SidebarShell from './SidebarShell'
import FileEditor from './FileEditor'
import type { FsNode } from './FileTree'

const TASK_TYPES = [
  { value: 'auto', label: '自动判定' },
  { value: 'software', label: '软件开发' },
  { value: 'document', label: '文档写作' },
  { value: 'video', label: '视频脚本' },
  { value: 'debug', label: '调试排错' },
  { value: 'general', label: '通用' },
]

const STATUS_STYLE: Record<StageStatus, { label: string; cls: string }> = {
  pending: { label: '待执行', cls: 'bg-gray-100 text-gray-500' },
  running: { label: '执行中', cls: 'bg-blue-100 text-blue-700' },
  'waiting-questions': { label: '待回答', cls: 'bg-amber-100 text-amber-700' },
  paused: { label: '已暂停', cls: 'bg-purple-100 text-purple-700' },
  done: { label: '已完成', cls: 'bg-green-100 text-green-700' },
  skipped: { label: '已跳过', cls: 'bg-gray-100 text-gray-400' },
  error: { label: '出错', cls: 'bg-red-100 text-red-700' },
  retrying: { label: '重试中', cls: 'bg-orange-100 text-orange-700' },
}

function StatusBadge({ status }: { status: StageStatus }): React.JSX.Element {
  const s = STATUS_STYLE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
}

// ─── 澄清问题表单（多选项 → 单选；无选项 → 文本） ─────────────────────────
function ClarifyForm({
  questions,
  onSubmit,
}: {
  questions: Array<{ id: string; text: string; options?: string[] }>
  onSubmit: (answers: Record<string, string>) => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return (
    <div className="space-y-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
      <div className="text-sm font-medium text-amber-800">生成前澄清（可选填写后生成）</div>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1">
          <div className="text-sm text-gray-700">{q.text}</div>
          {q.options && q.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  className={`text-xs px-2 py-1 rounded border ${
                    answers[q.id] === opt
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <input
              className="w-full text-sm border border-gray-300 rounded px-2 py-1"
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <button
        className="text-sm bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700"
        onClick={() => onSubmit(answers)}
      >
        带澄清答案生成工作流
      </button>
    </div>
  )
}

function provenanceLabel(provenance: string): string {
  const labels: Record<string, string> = {
    charter_direct: '主旨直接命中',
    charter_inferred: '主旨推导',
    escalated: '须人工确认',
    human: '人工',
  }
  return labels[provenance] ?? provenance
}

function seedAnswersFromQuestions(questions: Question[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of questions) {
    const suggested = q.suggestedAnswer?.trim()
    if (suggested) {
      out[q.id] = suggested
    }
  }
  return out
}

// ─── 阶段问答表单（questionBefore / questionAfter） ──────────────────────
function QuestionForm({
  title,
  questions,
  onSubmit,
}: {
  title: string
  questions: Question[]
  onSubmit: (answers: Record<string, string>) => void
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>(() => seedAnswersFromQuestions(questions))
  const missingRequired = questions.some((q) => q.required !== false && !(answers[q.id] ?? '').trim())
  return (
    <div className="space-y-2 border border-amber-200 bg-amber-50 rounded-lg p-3 mt-2">
      <div className="text-sm font-medium text-amber-800">{title}</div>
      {questions.map((q) => (
        <div
          key={q.id}
          className={`space-y-1 rounded px-2 py-1 ${
            q.provenance === 'charter_inferred'
              ? 'border-l-4 border-amber-400 bg-amber-50/80'
              : q.provenance === 'charter_direct'
                ? 'border-l-4 border-green-300 bg-green-50/40'
                : ''
          }`}
        >
          <label className="text-sm text-gray-700">
            {q.text}
            {q.required !== false && <span className="text-red-500"> *</span>}
          </label>
          {q.provenance && (
            <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {provenanceLabel(q.provenance)}
              {q.ruleRefs && q.ruleRefs.length > 0 ? ` · R#${q.ruleRefs.join(',R#')}` : ''}
            </span>
          )}
          {q.hint && <div className="text-xs text-gray-400">{q.hint}</div>}
          <textarea
            className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[2rem]"
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <button
        className="text-sm bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50"
        disabled={missingRequired}
        onClick={() => onSubmit(answers)}
      >
        提交回答
      </button>
    </div>
  )
}

// ─── 决策记录 6 条结构自检（移植自 VS Code webview，统一结构合同 §7.5） ──────
function computeDecisionChecks(text: string): { label: string; ok: boolean }[] {
  const scenarioCount = (text.match(/场景\s*[0-9一二三四五六七八九十]/g) || []).length
  const hasConflictCheck = /已检查：|潜在冲突：/.test(text)
  return [
    { label: '每条决策是否说明了“为什么不选备选方案”？', ok: /而非|备选|不选/.test(text) },
    { label: '“边界压力测试”节是否包含至少 2 个具体场景？', ok: scenarioCount >= 2 },
    { label: '“AI 无法验证的假设”节是否至少有 1 条？', ok: /AI 无法验证的假设/.test(text) },
    { label: '总字数是否 ≤ 800 字？', ok: text.length <= 800 },
    { label: '是否未混入代码（决策记录不应有代码）？', ok: !/function\s|class\s|const\s|let\s|var\s|=>/.test(text) },
    { label: '若涉及已有代码，是否标注了冲突检测结果？', ok: hasConflictCheck },
  ]
}

// ─── 决策评审：6 条结构自检 + 按需 AI 复核 + approveDecision ───────────────
function DecisionReview({
  stageId,
  onApprove,
  onReview,
}: {
  stageId: string
  onApprove: (decisionRecord: string) => void
  onReview: (
    stageId: string,
    decisionRecord: string,
  ) => Promise<{ ok: boolean; review?: string; model?: string; error?: string }>
}): React.JSX.Element {
  const [record, setRecord] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState<string | null>(null)
  const [reviewErr, setReviewErr] = useState<string | null>(null)
  const [reviewModel, setReviewModel] = useState<string | null>(null)

  const checks = computeDecisionChecks(record)
  const uncheckedCount = checks.filter((c) => !c.ok).length

  const runReview = async (): Promise<void> => {
    setReviewing(true)
    setReview(null)
    setReviewErr(null)
    try {
      const res = await onReview(stageId, record.trim())
      if (res.ok) {
        setReview(res.review ?? '(无返回)')
        setReviewModel(res.model ?? null)
      } else {
        setReviewErr(res.error ?? 'review-failed')
      }
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : String(e))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="space-y-2 border border-purple-200 bg-purple-50 rounded-lg p-3 mt-2">
      <div className="text-sm font-medium text-purple-800">决策评审 — 填写决策记录后批准</div>
      <textarea
        className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[6rem] font-mono"
        placeholder="记录此处所做的关键决策、取舍与依据…（建议含：备选方案与为什么不选、边界压力测试≥2场景、AI 无法验证的假设、冲突检测）"
        value={record}
        onChange={(e) => setRecord(e.target.value)}
      />

      {/* 结构自检（即时正则，软性提示，不阻断批准） */}
      <div className="rounded border border-purple-100 bg-white p-2">
        <div className="text-xs font-medium text-gray-600 mb-1">
          结构自检（{checks.length - uncheckedCount}/{checks.length}）
        </div>
        <ul className="space-y-0.5">
          {checks.map((c) => (
            <li key={c.label} className="text-xs flex items-start gap-1.5">
              <span className={c.ok ? 'text-green-600' : 'text-amber-500'}>{c.ok ? '✓' : '○'}</span>
              <span className={c.ok ? 'text-gray-500' : 'text-gray-700'}>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          className="text-sm bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
          disabled={!record.trim()}
          onClick={() => onApprove(record.trim())}
        >
          批准决策并继续
        </button>
        <button
          className="text-sm border border-purple-400 text-purple-700 px-3 py-1.5 rounded hover:bg-purple-100 disabled:opacity-50"
          disabled={!record.trim() || reviewing}
          onClick={() => void runReview()}
        >
          {reviewing ? 'AI 复核中…' : '🔍 AI 复核'}
        </button>
        {uncheckedCount > 0 && (
          <span className="text-xs text-amber-600">还有 {uncheckedCount} 条结构项未满足（可忽略直接批准）</span>
        )}
      </div>

      {reviewErr && (
        <div className="text-xs text-red-600 border border-red-200 bg-red-50 rounded px-2 py-1">
          AI 复核失败：{reviewErr}
        </div>
      )}
      {review && (
        <div className="text-xs text-gray-800 border border-blue-200 bg-blue-50 rounded px-2 py-2 whitespace-pre-wrap">
          <div className="font-medium text-blue-700 mb-1">
            AI 复核意见{reviewModel ? `（${reviewModel}）` : ''}
          </div>
          {review}
        </div>
      )}
    </div>
  )
}

// ─── 重试框 ─────────────────────────────────────────────────────────────
function RetryBox({ onRetry }: { onRetry: (comment: string) => void }): React.JSX.Element {
  const [comment, setComment] = useState('')
  return (
    <div className="space-y-2 mt-2">
      <textarea
        className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[2.5rem]"
        placeholder="给重试一些纠偏意见（可留空）…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        className="text-sm bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700"
        onClick={() => onRetry(comment.trim())}
      >
        重试此阶段
      </button>
    </div>
  )
}

function renderOutput(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

// ─── 真实 API 设置面板（#2：配置 llmApiKey/baseUrl/model） ──────────────
function SettingsPanel({
  load,
  save,
  onClose,
}: {
  load: () => Promise<StagentLlmConfig>
  save: (patch: Partial<StagentLlmConfig>) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [cfg, setCfg] = useState<StagentLlmConfig | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void load().then(setCfg)
  }, [load])

  if (!cfg) {
    return <div className="border-b border-gray-100 px-4 py-3 text-xs text-gray-400">加载配置…</div>
  }

  const field = (label: string, key: keyof StagentLlmConfig, type = 'text'): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      {label}
      <input
        type={type}
        className="border border-gray-300 rounded px-2 py-1 text-sm"
        value={String(cfg[key] ?? '')}
        onChange={(e) =>
          setCfg({
            ...cfg,
            [key]: type === 'number' ? Number(e.target.value) : e.target.value,
          })
        }
      />
    </label>
  )

  const bool = (label: string, key: keyof StagentLlmConfig): React.JSX.Element => (
    <label className="flex items-center gap-2 text-xs text-gray-600">
      <input
        type="checkbox"
        checked={Boolean(cfg[key])}
        onChange={(e) => setCfg({ ...cfg, [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <div className="border-b border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
      <div className="text-sm font-medium text-gray-700">真实 API 设置（OpenAI 兼容）</div>
      {field('API Key（留空则仅用本地浏览器 AI）', 'llmApiKey', 'password')}
      {field('Base URL', 'llmBaseUrl')}
      {field('模型名', 'llmModel')}
      {field('最大输出 tokens', 'llmMaxOutputTokens', 'number')}

      <div className="pt-2 text-sm font-medium text-gray-700">质量门 / 契约校验（M21）</div>
      {bool('计划完整性硬门（缺验证阶段 / main 装配 / 共享样例源时阻断生成）', 'plan.requireCompleteness')}
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        红绿门（impl 前测试需 RED）
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm"
          value={cfg['tdd.redGreenGate']}
          onChange={(e) =>
            setCfg({ ...cfg, 'tdd.redGreenGate': e.target.value as 'off' | 'warn' | 'hard' })
          }
        >
          <option value="off">off（关闭）</option>
          <option value="warn">warn（仅告警，默认）</option>
          <option value="hard">hard（impl 前真跑配对测试，GREEN 则阻断）</option>
        </select>
      </label>
      {bool('契约节点未达阈值时升级人工暂停（M21.4）', 'hitl.pauseContractNodes')}
      {field('契约节点暂停阈值（0–1，默认 0.75）', 'hitl.contractNodePauseThreshold', 'number')}
      {bool('debug 反馈回路优先：复现/回归须排在假设与修复之前（I-26）', 'debug.requireFeedbackLoop')}
      {bool('决策阶段自适应「一次一问」grill（M23，默认关）', 'grill.adaptiveMode')}
      {bool('活 CONTEXT.md 词汇表 + ADR 留存（M24）', 'glossary.enabled')}
      {bool('深模块评分接入质量分（M25，默认关）', 'architecture.depthScoring')}

      <div className="pt-2 text-sm font-medium text-gray-700">Skill-native 编排（实验，S3）</div>
      {bool('启用：用原版 Matt Pocock SKILL.md 编排工作流（grill native；默认关）', 'skillNative.enabled')}
      {field('Skills 根目录（含 engineering/ productivity/ … 的 skills 目录绝对路径）', 'skillNative.skillsRoot')}

      <div className="flex items-center gap-2 pt-1">
        <button
          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
          onClick={() => {
            void save({
              llmApiKey: cfg.llmApiKey.trim(),
              llmBaseUrl: cfg.llmBaseUrl.trim(),
              llmModel: cfg.llmModel.trim(),
              llmMaxOutputTokens: cfg.llmMaxOutputTokens,
              'plan.requireCompleteness': cfg['plan.requireCompleteness'],
              'tdd.redGreenGate': cfg['tdd.redGreenGate'],
              'hitl.pauseContractNodes': cfg['hitl.pauseContractNodes'],
              'hitl.contractNodePauseThreshold': cfg['hitl.contractNodePauseThreshold'],
              'debug.requireFeedbackLoop': cfg['debug.requireFeedbackLoop'],
              'grill.adaptiveMode': cfg['grill.adaptiveMode'],
              'glossary.enabled': cfg['glossary.enabled'],
              'architecture.depthScoring': cfg['architecture.depthScoring'],
              'skillNative.enabled': cfg['skillNative.enabled'],
              'skillNative.skillsRoot': cfg['skillNative.skillsRoot'],
            }).then(() => {
              setSaved(true)
              setTimeout(() => setSaved(false), 1500)
            })
          }}
        >
          保存
        </button>
        <button className="text-xs text-gray-500 hover:underline" onClick={onClose}>
          收起
        </button>
        {saved && <span className="text-xs text-green-600">已保存 ✓</span>}
      </div>
      <div className="text-[11px] text-gray-400">
        提示：OpenAI 用 https://api.openai.com/v1 ；DeepSeek 用 https://api.deepseek.com/v1 等。
      </div>
    </div>
  )
}

export default function StagentPage(): React.JSX.Element {
  const engine = useStagentEngine()
  const {
    state,
    send,
    resume,
    remove,
    reset,
    consumeWorkspacePath,
    selectTask,
    stages,
    models,
    preferredModel,
    setModel,
    getConfig,
    saveConfig,
    reviewDecision,
  } = engine
  const [showSettings, setShowSettings] = useState(false)
  // 左栏统一树的「选中任务」(驱动其文件树) 与中央「选中文件」(切到编辑器)。
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null)

  // M13: 资源池细化后模型列表会随「站点 × 档位 × 工具」线性变长，
  // 这里按站点折叠成 <optgroup> 分组，避免控制面板下拉变成一条长列表。
  const modelGroups = useMemo(() => groupModels(models), [models])

  // 输入表单本地状态
  const [draft, setDraft] = useState('')
  const [taskType, setTaskType] = useState('auto')
  const [workspacePath, setWorkspacePath] = useState('')

  // 选择文件夹回填
  useEffect(() => {
    if (state.pickedWorkspacePath) {
      setWorkspacePath(state.pickedWorkspacePath)
      consumeWorkspacePath()
    }
  }, [state.pickedWorkspacePath, consumeWorkspacePath])

  // 进入确认/执行后，自动把活跃实例对应的任务设为选中，让左树默认展开当前任务的文件。
  const activeWorkspacePath = state.workflow?.meta?.taskWorkspacePath
  useEffect(() => {
    const key = state.activeInstanceKey ?? state.draftInstanceKey
    if (key) {
      const byKey = state.tasks.find((t) => t.instanceKey === key)
      if (byKey) {
        setSelectedTaskKey(byKey.instanceKey)
        return
      }
    }
    if (!activeWorkspacePath) {
      return
    }
    const sameWs = state.tasks.filter((t) => t.taskWorkspacePath === activeWorkspacePath)
    if (sameWs.length === 1) {
      setSelectedTaskKey(sameWs[0].instanceKey)
    }
  }, [activeWorkspacePath, state.tasks, state.activeInstanceKey, state.draftInstanceKey])

  // 产物落盘高亮集合：从 artifacts 派生（filePath 多为相对路径，按 basename 命中）。
  const newPaths = useMemo(() => {
    const set = new Set<string>()
    for (const hints of Object.values(state.artifacts)) {
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
  }, [state.artifacts])

  const canGenerate = draft.trim().length > 0 && workspacePath.trim().length > 0

  function newTask(): void {
    // 放弃确认页 / 新建任务：若已持久化 idle 草稿，一并删除其记录，避免侧栏残留未执行草稿。
    const draftKey = state.draftInstanceKey
    if (draftKey) {
      void remove(draftKey)
    }
    reset()
    setDraft('')
    setTaskType('auto')
    setWorkspacePath('')
    setSelectedTaskKey(null)
    setSelectedFile(null)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── 左栏：可拖拽宽度 / 可折叠为图标栏 + 统一任务树 ─────────────── */}
      <SidebarShell taskCount={state.tasks.length} onNewTask={newTask}>
        <TaskTree
          tasks={state.tasks}
          selectedTaskKey={selectedTaskKey}
          selectedFilePath={selectedFile?.path ?? null}
          newPaths={newPaths}
          refreshNonce={state.fileTreeRevision}
          onSelectTask={(key) => {
            selectTask(key)
            setSelectedTaskKey((prev) => (prev === key ? null : key))
            setSelectedFile(null)
          }}
          onSelectFile={(node: FsNode) => setSelectedFile({ path: node.path, name: node.name })}
          onNewTask={newTask}
          onResume={(key) => void resume(key)}
          onRemove={(key, scope) => void remove(key, scope)}
        />
      </SidebarShell>

      {/* ── 主面板 ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        {state.busy && (
          <div className="sticky top-0 z-10 bg-blue-50 border-b border-blue-100 px-4 py-2 text-sm text-blue-700">
            ⏳ {state.busy.message}
            {state.busy.detail ? ` — ${state.busy.detail}` : ''}
          </div>
        )}
        {state.switchBlocked && (
          <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            ⚠ {state.switchBlocked.reason}
          </div>
        )}

        {/* LLM 提供方链：真实 API 优先 · 本地 :8787 降级 */}
        <div className="border-b border-gray-100 px-4 py-2 flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">模型</span>
          {models.length === 0 ? (
            <span className="text-xs text-gray-400">
              无可用模型（配置 API Key 或连接本地 AI 后启用）
            </span>
          ) : (
            <select
              className="text-xs border border-gray-300 rounded px-2 py-1 max-w-full"
              value={preferredModel}
              onChange={(e) => void setModel(e.target.value)}
            >
              <option value="">默认（{models[0]?.name ?? '自动'}）</option>
              {modelGroups.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.text}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <button
            className="ml-auto text-xs text-gray-500 hover:text-gray-800 hover:underline shrink-0"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? '收起设置' : 'API 设置'}
          </button>
        </div>

        {showSettings && (
          <SettingsPanel load={getConfig} save={saveConfig} onClose={() => setShowSettings(false)} />
        )}

        {/* 全局失败横幅：生成/澄清等非执行阶段的失败也要可见（执行阶段另有内联横幅） */}
        {state.failed && state.phase !== 'execution' && (
          <div className="mx-4 mt-3 border border-red-200 bg-red-50 rounded-lg px-4 py-2 text-sm text-red-700">
            ✗ 失败（{state.failed.errorType}）：{state.failed.reason}
          </div>
        )}

        {selectedFile ? (
          <FileEditor
            filePath={selectedFile.path}
            name={selectedFile.name}
            onClose={() => setSelectedFile(null)}
          />
        ) : (
        <div className="flex-1 overflow-y-auto"><div className="max-w-5xl mx-auto p-5">
          {/* ── 输入阶段 ─────────────────────────────────────────── */}
          {state.phase === 'input' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">新建决策式工作流</h2>
                <button
                  className="text-xs text-gray-500 hover:underline"
                  title="复制本任务完整调试日志（润色 / 澄清 / 生成 / 执行）"
                  onClick={() => void send({ type: 'copyDebugLog' })}
                >
                  复制调试日志
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-sm text-gray-600">任务描述</label>
                <textarea
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 resize-y min-h-[7rem]"
                  placeholder="描述你想完成的任务，例如：用 Vite + React 做一个二维码生成器…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </div>

              <div className="flex gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-gray-600">任务类型</label>
                  <select
                    className="text-sm border border-gray-300 rounded-lg px-2 py-2"
                    value={taskType}
                    onChange={(e) => setTaskType(e.target.value)}
                  >
                    {TASK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 flex-1">
                  <label className="text-sm text-gray-600">工作文件夹（必填）</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2"
                      placeholder="~/projects/my-task 或绝对路径"
                      value={workspacePath}
                      onChange={(e) => setWorkspacePath(e.target.value)}
                    />
                    <button
                      className="text-sm border border-gray-300 rounded-lg px-3 hover:bg-gray-50"
                      onClick={() => void send({ type: 'pickTaskWorkspaceFolder' })}
                    >
                      选择…
                    </button>
                  </div>
                </div>
              </div>

              {state.polishHint && (
                <div className="border border-amber-100 bg-amber-50/80 rounded-lg px-3 py-2 text-sm text-amber-900">
                  {state.polishHint}
                </div>
              )}

              {state.polished && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
                  <div className="text-sm font-medium text-green-800">
                    润色结果{state.polished.fromCache ? '（缓存）' : ''}
                  </div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{state.polished.text}</div>
                  <button
                    className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                    onClick={() => setDraft(state.polished!.text)}
                  >
                    采用为任务描述
                  </button>
                </div>
              )}

              {state.clarify && state.clarify.length > 0 && (
                <ClarifyForm
                  questions={state.clarify}
                  onSubmit={(clarifyAnswers) =>
                    void send({
                      type: 'generateWorkflow',
                      userInput: draft.trim(),
                      taskType,
                      taskWorkspacePath: workspacePath.trim(),
                      clarifyAnswers,
                      ...(state.polished
                        ? { polishContext: { originalDraft: draft, polishedAt: state.polished.polishedAt } }
                        : {}),
                    })
                  }
                />
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  className="text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                  disabled={!draft.trim() || !!state.busy}
                  onClick={() =>
                    void send({
                      type: 'polishUserTask',
                      draft: draft.trim(),
                      taskType,
                      taskWorkspacePath: workspacePath.trim() || undefined,
                    })
                  }
                >
                  需求润色
                </button>
                <button
                  className="text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
                  disabled={!canGenerate || !!state.busy}
                  onClick={() =>
                    void send({
                      type: 'clarifyStart',
                      userInput: draft.trim(),
                      taskType,
                      taskWorkspacePath: workspacePath.trim(),
                    })
                  }
                >
                  生成澄清问题
                </button>
                <button
                  className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                  disabled={!canGenerate || !!state.busy}
                  onClick={() =>
                    void send({
                      type: 'generateWorkflow',
                      userInput: draft.trim(),
                      taskType,
                      taskWorkspacePath: workspacePath.trim(),
                      ...(state.polished
                        ? { polishContext: { originalDraft: draft, polishedAt: state.polished.polishedAt } }
                        : {}),
                    })
                  }
                >
                  生成工作流
                </button>
              </div>
            </div>
          )}

          {/* ── 确认阶段 ─────────────────────────────────────────── */}
          {state.phase === 'confirm' && state.workflow && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">{state.workflow.meta.title}</h2>
                <button className="text-sm text-gray-500 hover:underline" onClick={newTask}>
                  放弃并重来
                </button>
              </div>
              <div className="text-xs text-gray-400">
                类型：{state.workflow.meta.taskType}
                {state.workflow.meta.workflowTemplate
                  ? ` · 路径：${state.taskTypeClassification?.workflowTemplatePlain ?? state.workflow.meta.workflowTemplate}`
                  : ''}
                {state.workflow.meta.isGreenfield === true
                  ? ' · 绿场'
                  : state.workflow.meta.isGreenfield === false
                    ? ' · 棕场'
                    : ''}
                {' · 共 '}
                {stages.length} 阶段
              </div>

              {state.taskTypeClassification && state.taskTypeClassification.rationaleLines.length > 0 && (
                <div className="border border-blue-100 bg-blue-50 rounded-lg p-3 space-y-1">
                  <div className="text-sm font-medium text-blue-800">路径判别依据</div>
                  {state.taskTypeClassification.rationaleLines.map((line, i) => (
                    <div key={i} className="text-sm text-blue-700">
                      • {line}
                    </div>
                  ))}
                </div>
              )}

              {state.decisionBoard && state.decisionBoard.summary.total > 0 && (
                <div className="border border-purple-100 bg-purple-50 rounded-lg p-3 space-y-2">
                  <div className="text-sm font-medium text-purple-800">
                    决策板 · 自动 {state.decisionBoard.summary.auto} / 待审{' '}
                    {state.decisionBoard.summary.needsReview}
                  </div>
                  {state.decisionBoard.items.slice(0, 6).map((item, i) => (
                    <div key={i} className="text-xs text-purple-700">
                      • {(item.stageTitle as string) ?? (item.stageId as string)}
                      {item.requiresUser ? '（需确认）' : ''}
                    </div>
                  ))}
                </div>
              )}

              {state.blocked && state.blockReasons.length > 0 && (
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-1">
                  <div className="text-sm font-medium text-red-700">硬门禁拦截，禁止执行：</div>
                  {state.blockReasons.map((r, i) => (
                    <div key={i} className="text-sm text-red-600">• {r}</div>
                  ))}
                </div>
              )}

              {state.warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-1">
                  <div className="text-sm font-medium text-amber-700">提示：</div>
                  {state.warnings.map((w, i) => (
                    <div key={i} className="text-sm text-amber-700">• {w}</div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {stages.map((s, i) => (
                  <div key={s.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{i + 1}</span>
                      <span className="text-sm font-medium text-gray-800">{s.title}</span>
                      {s.isDecisionStage && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                          决策
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 ml-auto">{s.tool}</span>
                    </div>
                    {s.description && <div className="text-xs text-gray-500 mt-1">{s.description}</div>}
                    {s.aiTip && <div className="text-xs text-blue-500 mt-1">审核重点：{s.aiTip}</div>}
                  </div>
                ))}
              </div>

              <button
                className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                disabled={state.blocked}
                onClick={() =>
                  void send({
                    type: 'startExecution',
                    workflow: state.workflow,
                    instanceKey: state.activeInstanceKey ?? state.draftInstanceKey,
                  })
                }
              >
                开始执行
              </button>
            </div>
          )}

          {/* ── 执行阶段 ─────────────────────────────────────────── */}
          {state.phase === 'execution' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">
                  {state.workflow?.meta.title ?? '工作流执行'}
                </h2>
                <div className="flex items-center gap-3">
                  <button
                    className="text-xs text-gray-500 hover:underline"
                    title="复制本任务完整调试日志（润色 / 澄清 / 生成 / 执行）"
                    onClick={() => void send({ type: 'copyDebugLog' })}
                  >
                    复制调试日志
                  </button>
                </div>
              </div>

              {state.engineActivityFeed.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  <div className="font-medium text-gray-600">引擎活动</div>
                  {state.engineActivityFeed.length === 0 ? (
                    <div className="text-gray-400">暂无引擎活动</div>
                  ) : (
                    state.engineActivityFeed.slice(-8).map((e, i) => (
                      <div key={i} className="text-gray-600 flex gap-2 items-start">
                        <span
                          className={`shrink-0 px-1 rounded text-[10px] uppercase ${
                            e.kind === 'replan'
                              ? 'bg-purple-100 text-purple-700'
                              : e.kind === 'gate'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {e.kind}
                        </span>
                        <span>
                          {e.text}
                          {e.stageId ? ` · ${e.stageId}` : ''}
                          {e.timestamp ? (
                            <span className="text-gray-400 ml-1">
                              {new Date(e.timestamp).toLocaleTimeString()}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {state.completed && (
                <div className="border border-green-200 bg-green-50 rounded-lg p-3 text-sm text-green-700 space-y-2">
                  <div>✓ 工作流已完成</div>
                  {state.qualityReport && (
                    <div className="border-t border-green-200 pt-2">
                      <QualityReportPanel report={state.qualityReport} />
                    </div>
                  )}
                </div>
              )}
              {state.failed && (
                <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700 space-y-2">
                  <div>
                    ✗ 工作流失败（{state.failed.errorType}）：{state.failed.reason}
                  </div>
                  {state.workflow && (state.activeInstanceKey ?? state.draftInstanceKey) && (
                    <button
                      type="button"
                      className="text-sm bg-orange-600 text-white rounded px-3 py-1.5 hover:bg-orange-700"
                      onClick={() =>
                        void send({
                          type: 'startExecution',
                          workflow: state.workflow,
                          instanceKey: state.activeInstanceKey ?? state.draftInstanceKey,
                        })
                      }
                    >
                      从头重新执行
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {stages.map((s, i) => {
                  const status = state.stageStatus[s.id] ?? 'pending'
                  const stream = state.streams[s.id]
                  const outputs = state.outputs[s.id]
                  const confidence = state.confidence[s.id]
                  const err = state.errors[s.id]
                  const qb = state.questionsBefore[s.id]
                  const q = state.questions[s.id]
                  const arts = state.artifacts[s.id]
                  const isDecision = state.decisionStageId === s.id
                  const isPaused = state.pausedStageId === s.id
                  const isFocused = state.focusFailedStageId === s.id
                  const isReplan = s.id.includes('stage_runtime_replan_')
                  return (
                    <div
                      key={s.id}
                      id={isFocused ? 'stagent-focus-stage' : undefined}
                      className={`border rounded-lg p-3 ${
                        isFocused
                          ? 'border-orange-400 ring-2 ring-orange-200'
                          : isReplan
                            ? 'border-purple-300 bg-purple-50/40'
                            : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{i + 1}</span>
                        <span className="text-sm font-medium text-gray-800">{s.title}</span>
                        <StatusBadge status={status} />
                        {confidence && (
                          <span
                            className={`text-[11px] px-1.5 py-0.5 rounded ${
                              confidence.level === 'critical' || confidence.level === 'low'
                                ? 'bg-red-100 text-red-600'
                                : confidence.level === 'medium'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-green-100 text-green-700'
                            }`}
                            title={confidence.reasons.join('\n')}
                          >
                            置信 {Math.round(confidence.score * 100)}%
                          </span>
                        )}
                      </div>

                      {stream && (
                        <pre className="mt-2 text-xs bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64">
                          {stream}
                        </pre>
                      )}

                      {outputs &&
                        Object.entries(outputs).map(([k, v]) => (
                          <div key={k} className="mt-2">
                            <div className="text-[11px] text-gray-400">{k}</div>
                            <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48">
                              {renderOutput(v)}
                            </pre>
                          </div>
                        ))}

                      {arts && arts.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {arts.map((a, ai) => (
                            <button
                              key={ai}
                              className="text-[11px] text-blue-600 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50"
                              onClick={() =>
                                void send({ type: 'openArtifactFile', stageId: s.id, filePath: a.filePath })
                              }
                              title={a.filePath}
                            >
                              📄 {a.filePath}
                            </button>
                          ))}
                        </div>
                      )}

                      {qb && qb.length > 0 && (
                        <QuestionForm
                          title={
                            qb.some((q) => q.suggestedAnswer?.trim())
                              ? '以下为主旨推荐答案，请确认或修改后提交：'
                              : '执行前需要你回答：'
                          }
                          questions={qb}
                          onSubmit={(answers) =>
                            void send({ type: 'answerQuestionsBefore', stageId: s.id, answers })
                          }
                        />
                      )}

                      {q && q.length > 0 && (
                        <QuestionForm
                          title="本阶段追问："
                          questions={q}
                          onSubmit={(answers) =>
                            void send({ type: 'answerQuestions', stageId: s.id, answers })
                          }
                        />
                      )}

                      {isDecision && (
                        <DecisionReview
                          stageId={s.id}
                          onApprove={(decisionRecord) =>
                            void send({ type: 'approveDecision', stageId: s.id, decisionRecord })
                          }
                          onReview={reviewDecision}
                        />
                      )}

                      {isPaused && !isDecision && (
                        <button
                          className="mt-2 text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
                          onClick={() => void send({ type: 'approve', stageId: s.id })}
                        >
                          确认并继续
                        </button>
                      )}

                      {(err || status === 'error') && (
                        <div className="mt-2 border border-red-200 bg-red-50 rounded p-2">
                          {err?.userTitle && (
                            <div className="text-sm font-medium text-red-800">{err.userTitle}</div>
                          )}
                          <div className="text-sm text-red-700">
                            出错{err ? `（${err.errorType}）` : ''}：
                            {err?.userBody ?? err?.error ?? '阶段执行失败，可填写重试说明后再次执行。'}
                          </div>
                          {err?.playbookSteps && err.playbookSteps.length > 0 && (
                            <ul className="text-xs text-red-600 mt-1 list-disc list-inside">
                              {err.playbookSteps.map((step, si) => (
                                <li key={si}>{step}</li>
                              ))}
                            </ul>
                          )}
                          {(err?.stdout || err?.stderr) && (
                            <pre className="text-[11px] text-red-600 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
                              {err.stdout}
                              {err.stderr}
                            </pre>
                          )}
                          <RetryBox onRetry={(comment) => void send({ type: 'retry', stageId: s.id, comment })} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div></div>
        )}
      </main>
    </div>
  )
}
