/* ------------------------------------------------------------------ */
/*  StagentPage — 渐进式披露统一驾驶舱壳(单一 5 步,密度由 showTechnical 控制) */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FrontendMessage } from '@stagent/core'
import { useStagentEngine } from '../stagent/useStagentEngine'
import { CockpitProvider, useCockpitContext } from '../stagent/cockpit/CockpitContext'
import { CockpitHeader } from '../stagent/cockpit/components/CockpitHeader'
import { Stepper } from '../stagent/cockpit/components/Stepper'
import { deriveStep } from '../stagent/cockpit/deriveCockpitStep'
import { ScreenRouter } from '../stagent/cockpit/ScreenRouter'
import TaskTree from './TaskTree'
import SidebarShell from './SidebarShell'
import FileEditor from './FileEditor'
import type { FsNode } from './FileTree'

function StagentPageInner(): React.JSX.Element {
  const { showTechnical } = useCockpitContext()
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
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [taskType, setTaskType] = useState('auto')
  const [workspacePath, setWorkspacePath] = useState('')
  const [clarifyPending, setClarifyPending] = useState(false)
  const pendingFolderThenClarifyRef = useRef(false)
  const awaitingClarifyRef = useRef(false)

  const step = useMemo(() => {
    if (clarifyPending && state.phase === 'input') {
      return 2 as const
    }
    return deriveStep(state)
  }, [clarifyPending, state])

  const form = useMemo(
    () => ({ draft, setDraft, taskType, setTaskType, workspacePath, setWorkspacePath }),
    [draft, taskType, workspacePath],
  )

  const engineSlice = useMemo(
    () => ({
      state,
      stages,
      models,
      preferredModel,
      setModel,
      getConfig,
      saveConfig,
      reviewDecision,
    }),
    [state, stages, models, preferredModel, setModel, getConfig, saveConfig, reviewDecision],
  )

  const sendVoid = useCallback(
    async (msg: FrontendMessage): Promise<void> => {
      await send(msg)
    },
    [send],
  )

  const sendGenerateWorkflow = useCallback(
    (clarifyAnswers?: Record<string, string>) => {
      void sendVoid({
        type: 'generateWorkflow',
        userInput: draft.trim(),
        taskType,
        taskWorkspacePath: workspacePath.trim(),
        ...(clarifyAnswers && Object.keys(clarifyAnswers).length > 0 ? { clarifyAnswers } : {}),
        ...(state.polished
          ? { polishContext: { originalDraft: draft.trim(), polishedAt: state.polished.polishedAt } }
          : {}),
      })
    },
    [draft, taskType, workspacePath, state.polished, sendVoid],
  )

  const sendClarifyStart = useCallback(
    (taskWorkspacePath: string) => {
      awaitingClarifyRef.current = true
      setClarifyPending(true)
      void sendVoid({
        type: 'clarifyStart',
        userInput: draft.trim(),
        taskType,
        taskWorkspacePath,
      })
    },
    [draft, taskType, sendVoid],
  )

  useEffect(() => {
    if (state.pickedWorkspacePath) {
      const picked = state.pickedWorkspacePath
      setWorkspacePath(picked)
      consumeWorkspacePath()
      if (pendingFolderThenClarifyRef.current && draft.trim()) {
        pendingFolderThenClarifyRef.current = false
        sendClarifyStart(picked)
      }
    }
  }, [state.pickedWorkspacePath, consumeWorkspacePath, draft, sendClarifyStart])

  useEffect(() => {
    if (!awaitingClarifyRef.current || state.clarify === undefined) {
      return
    }
    awaitingClarifyRef.current = false
    setClarifyPending(false)
    if (state.clarify.length === 0) {
      sendGenerateWorkflow()
    }
  }, [state.clarify, sendGenerateWorkflow])

  useEffect(() => {
    if (state.failed) {
      awaitingClarifyRef.current = false
      setClarifyPending(false)
    }
  }, [state.failed])

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

  function startClarifyFlow(): void {
    if (!draft.trim()) {
      return
    }
    if (!workspacePath.trim()) {
      pendingFolderThenClarifyRef.current = true
      void sendVoid({ type: 'pickTaskWorkspaceFolder' })
      return
    }
    sendClarifyStart(workspacePath.trim())
  }

  function newTask(): void {
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
    pendingFolderThenClarifyRef.current = false
    awaitingClarifyRef.current = false
    setClarifyPending(false)
  }

  return (
    <div className="flex h-full min-h-0 bg-stagent-cream">
      {showTechnical && (
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
      )}

      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <CockpitHeader
          tasks={state.tasks}
          onNewTask={newTask}
          onSelectTask={(key) => {
            selectTask(key)
            setSelectedTaskKey(key)
          }}
          onResume={(key) => void resume(key)}
        />

        {(state.busy || clarifyPending) && (
          <div className="sticky top-0 z-10 px-4 py-2 text-sm bg-orange-50 text-stagent-orange border-b border-orange-100">
            ⏳{' '}
            {state.busy
              ? `${state.busy.message}${state.busy.detail ? ` — ${state.busy.detail}` : ''}`
              : '正在理解你的需求…'}
          </div>
        )}
        {state.switchBlocked && (
          <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            ⚠ {state.switchBlocked.reason}
          </div>
        )}

        {state.failed && state.phase !== 'execution' && (
          <div className="mx-4 mt-3 border border-red-200 bg-red-50 rounded-lg px-4 py-2 text-sm text-red-700">
            ✗ 失败({state.failed.errorType}):{state.failed.reason}
          </div>
        )}

        {selectedFile && showTechnical ? (
          <FileEditor filePath={selectedFile.path} name={selectedFile.name} onClose={() => setSelectedFile(null)} />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Stepper step={step} />
            <div className="max-w-3xl mx-auto px-4 pb-10">
              <ScreenRouter
                engine={engineSlice}
                form={form}
                onNewTask={newTask}
                send={sendVoid}
                showSettings={showSettings}
                setShowSettings={setShowSettings}
                onStartClarifyFlow={startClarifyFlow}
                clarifyPending={clarifyPending}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default function StagentPage(): React.JSX.Element {
  return (
    <CockpitProvider>
      <StagentPageInner />
    </CockpitProvider>
  )
}
