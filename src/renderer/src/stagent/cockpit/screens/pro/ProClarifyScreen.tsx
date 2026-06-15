import React from 'react'
import { DecisionGatePanel } from '../../components/DecisionGatePanel'
import { inferRecommendedOption } from '../../components/PillOptionGroup'
import type { CockpitScreenProps } from '../../types'

export function ProClarifyScreen({ engine, form, send }: CockpitScreenProps): React.JSX.Element {
  const { state } = engine
  const questions = (state.clarify ?? []).map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
    recommendedOption: inferRecommendedOption(q.options ?? []),
  }))

  if (!questions.length) {
    return <div className="text-gray-500 text-sm">暂无澄清问题，请从屏0 发起。</div>
  }

  return (
    <DecisionGatePanel
      pro
      questions={questions}
      submitLabel="带澄清答案生成工作流"
      onSubmit={(clarifyAnswers) =>
        void send({
          type: 'generateWorkflow',
          userInput: form.draft.trim(),
          taskType: form.taskType,
          taskWorkspacePath: form.workspacePath.trim(),
          clarifyAnswers,
          ...(state.polished
            ? { polishContext: { originalDraft: form.draft, polishedAt: state.polished.polishedAt } }
            : {}),
        })
      }
    />
  )
}
