import React, { useEffect, useState } from 'react'
import type { StagentLlmConfig } from '../../useStagentEngine'

export function SettingsPanel({
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
    return <div className="border-b border-white/10 px-4 py-3 text-xs text-slate-500">加载配置…</div>
  }

  const field = (label: string, key: keyof StagentLlmConfig, type = 'text'): React.JSX.Element => (
    <label className="flex flex-col gap-1 text-xs text-slate-300">
      {label}
      <input
        type={type}
        className="border border-white/15 rounded px-2 py-1 text-sm"
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
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={Boolean(cfg[key])}
        onChange={(e) => setCfg({ ...cfg, [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <div className="border-b border-white/10 px-4 py-3 bg-white/5 space-y-2">
      <div className="text-sm font-medium text-slate-200">真实 API 设置（OpenAI 兼容）</div>
      {field('API Key（留空则仅用本地浏览器 AI）', 'llmApiKey', 'password')}
      {field('Base URL', 'llmBaseUrl')}
      {field('模型名', 'llmModel')}
      {field('最大输出 tokens', 'llmMaxOutputTokens', 'number')}
      <div className="pt-2 text-sm font-medium text-slate-200">质量门 / 契约校验（M21）</div>
      {bool('计划完整性硬门', 'plan.requireCompleteness')}
      <label className="flex flex-col gap-1 text-xs text-slate-300">
        红绿门（impl 前测试需 RED）
        <select
          className="border border-white/15 rounded px-2 py-1 text-sm"
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
      {bool('debug 反馈回路优先（I-26）', 'debug.requireFeedbackLoop')}
      {bool('决策阶段自适应 grill（M23）', 'grill.adaptiveMode')}
      {bool('活 CONTEXT.md 词汇表 + ADR 留存（M24）', 'glossary.enabled')}
      {bool('深模块评分接入质量分（M25）', 'architecture.depthScoring')}
      <div className="pt-2 text-sm font-medium text-slate-200">Skill-native 编排（实验，S3）</div>
      {bool('启用 Skill-native 编排', 'skillNative.enabled')}
      {field('Skills 根目录', 'skillNative.skillsRoot')}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
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
        <button type="button" className="text-xs text-slate-400 hover:underline" onClick={onClose}>
          收起
        </button>
        {saved && <span className="text-xs text-green-400">已保存 ✓</span>}
      </div>
    </div>
  )
}
