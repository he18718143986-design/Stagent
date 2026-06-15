import React from 'react'
import type { StageArtifactHint } from '@stagent/core'
import { QualityReportPanel } from '../../../QualityReportPanel'
import { proTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'

export function ProDeliveryScreen({ engine, send }: CockpitScreenProps): React.JSX.Element {
  const { state } = engine
  const deliveryArtifact = Object.values(state.artifacts)
    .flat()
    .find((a: StageArtifactHint) => /DELIVERY\.md/i.test(a.filePath))

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">质量报告 + 交付</h2>
      <div className="border border-green-200 bg-green-50 rounded-lg p-4 text-green-800">✓ 工作流已完成</div>
      {state.qualityReport && <QualityReportPanel report={state.qualityReport} />}
      <div className={`${proTheme.card}`}>
        <div className="text-sm font-medium text-gray-700 mb-2">交付区</div>
        {deliveryArtifact ? (
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() =>
              void send({
                type: 'openArtifactFile',
                stageId: '',
                filePath: deliveryArtifact.filePath,
              })
            }
          >
            打开 DELIVERY.md
          </button>
        ) : (
          <p className="text-sm text-gray-500">暂无 DELIVERY.md 产物</p>
        )}
        {state.workflow?.meta.taskWorkspacePath && (
          <button
            type="button"
            className="mt-2 block text-sm bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
            onClick={() =>
              void send({
                type: 'openArtifactFile',
                stageId: '',
                filePath: state.workflow!.meta.taskWorkspacePath!,
              })
            }
          >
            打开工作区文件夹
          </button>
        )}
      </div>
    </div>
  )
}
