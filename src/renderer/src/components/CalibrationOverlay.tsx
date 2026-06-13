/* ------------------------------------------------------------------ */
/*  components/CalibrationOverlay.tsx — Two-step calibration UI (M5)  */
/*                                                                      */
/*  Rendered in the top 120px of the window while the BrowserView      */
/*  occupies the area below.  Listens for calibrate:step events from   */
/*  the main process and shows the appropriate instruction.            */
/* ------------------------------------------------------------------ */

import React, { useEffect, useState } from 'react'

interface StepData {
  step: 1 | 2
  instruction: string
}

interface Props {
  /** The hostname being calibrated — shown as context. */
  hostname: string
  /** Called when the user clicks "取消校准". */
  onCancel: () => void
}

export default function CalibrationOverlay({ hostname, onCancel }: Props): React.JSX.Element {
  const [stepData, setStepData] = useState<StepData>({
    step: 1,
    instruction: '请点击你输入消息的地方',
  })

  useEffect(() => {
    const unsub = window.autoAI.calibrate.onStep((data) => {
      setStepData(data)
    })
    return unsub
  }, [])

  return (
    /* Fixed bar covering exactly the top 120px — above the BrowserView bounds. */
    <div className="fixed inset-x-0 top-0 h-[120px] bg-white border-b border-gray-200 z-50 flex flex-col">
      {/* Traffic-light drag region (must stay visible) */}
      <div className="drag-region h-10 shrink-0" />

      {/* Instruction content */}
      <div className="flex flex-1 items-center justify-between px-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-400">
            步骤 {stepData.step}/2 · 正在校准 {hostname}
          </span>
          <span className="text-sm font-semibold text-gray-900">{stepData.instruction}</span>
          <span className="text-xs text-gray-400 mt-0.5">
            将光标移到页面上的元素后点击即可选定
          </span>
        </div>

        <button
          onClick={onCancel}
          className="no-drag shrink-0 ml-4 text-xs text-gray-400 hover:text-gray-700
                     underline underline-offset-2 transition-colors"
        >
          取消校准
        </button>
      </div>
    </div>
  )
}
