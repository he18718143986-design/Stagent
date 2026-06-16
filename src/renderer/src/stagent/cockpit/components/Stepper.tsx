import React from 'react'
import type { Step } from '../deriveCockpitStep'
import { STEP_LABELS } from '../deriveCockpitStep'

/** 统一进度条:单一 5 步、从 1 编号,两种密度共用。 */
export function Stepper({ step }: { step: Step }): React.JSX.Element {
  return (
    <nav className="flex items-center justify-center gap-2 sm:gap-4 px-4 py-5 flex-wrap" aria-label="进度">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step
        const done = step > n
        const active = step === n
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <div className={`hidden sm:block w-8 h-0.5 ${done ? 'bg-green-500/60' : 'bg-white/10'}`} />
            )}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? 'bg-orange-500/15 text-stagent-orange ring-2 ring-stagent-orange/30'
                  : done
                    ? 'text-green-400'
                    : 'text-slate-500'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  active
                    ? 'bg-stagent-orange text-white'
                    : done
                      ? 'bg-green-500 text-white'
                      : 'bg-white/10 text-slate-400'
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
