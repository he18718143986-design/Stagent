import React from 'react'
import type { ProStep } from '../deriveCockpitStep'
import { PRO_STEP_LABELS } from '../deriveCockpitStep'

export function ProStepper({ step }: { step: ProStep }): React.JSX.Element {
  return (
    <nav className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 overflow-x-auto" aria-label="六屏进度">
      {PRO_STEP_LABELS.map((label, i) => {
        const n = i as ProStep
        const done = step > n
        const active = step === n
        return (
          <div
            key={label}
            className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
              active
                ? 'bg-blue-100 text-blue-800'
                : done
                  ? 'text-green-600'
                  : 'text-gray-400'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                active ? 'bg-blue-600 text-white' : done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {done ? '✓' : i}
            </span>
            {label}
          </div>
        )
      })}
    </nav>
  )
}
