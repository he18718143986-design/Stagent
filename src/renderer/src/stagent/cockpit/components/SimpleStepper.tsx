import React from 'react'
import type { SimpleStep } from '../deriveCockpitStep'
import { SIMPLE_STEP_LABELS } from '../deriveCockpitStep'

export function SimpleStepper({ step }: { step: SimpleStep }): React.JSX.Element {
  return (
    <nav className="flex items-center justify-center gap-2 sm:gap-4 px-4 py-5 flex-wrap" aria-label="进度">
      {SIMPLE_STEP_LABELS.map((label, i) => {
        const n = (i + 1) as SimpleStep
        const done = step > n
        const active = step === n
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={`hidden sm:block w-8 h-0.5 ${done ? 'bg-stagent-success' : 'bg-stone-200'}`} />}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? 'bg-orange-100 text-stagent-orange ring-2 ring-stagent-orange/30'
                  : done
                    ? 'text-stagent-success'
                    : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  active
                    ? 'bg-stagent-orange text-white'
                    : done
                      ? 'bg-stagent-success text-white'
                      : 'bg-stone-200 text-stone-500'
                }`}
              >
                {done ? '✓' : n}
              </span>
              <span className="whitespace-nowrap">{label}</span>
            </div>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
