import React from 'react'
import { simpleTheme } from '../theme'

const FAQ = [
  { q: '打不开怎么办？', a: '找到下载的文件，双击打开。如果系统提示「无法验证」，在设置里允许一次即可。' },
  { q: '想加新功能怎么办？', a: '回到首页，告诉我们要改什么，我们会帮你更新。' },
]

export function HowToUsePanel({ onClose, onRedownload }: { onClose: () => void; onRedownload?: () => void }): React.JSX.Element {
  const [openFaq, setOpenFaq] = React.useState<number | null>(null)
  return (
    <div className="fixed inset-0 z-50 bg-stagent-cream overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-8">
        <h2 className={`${simpleTheme.heading} text-center mb-2`}>怎么用？</h2>
        <p className={`${simpleTheme.subheading} text-center mb-8`}>三步就能上手</p>
        <div className="space-y-4 mb-8">
          {[
            { n: 1, title: '找到文件', desc: '点击「下载」后，文件会保存到你的电脑里。' },
            { n: 2, title: '按提示操作', desc: '双击打开，按照屏幕上的说明使用即可。' },
            { n: 3, title: '有问题告诉我们', desc: '遇到任何问题，随时回来跟我们说。' },
          ].map((s) => (
            <div key={s.n} className={simpleTheme.card}>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-full bg-stagent-orange text-white flex items-center justify-center font-bold shrink-0">
                  {s.n}
                </span>
                <div>
                  <div className="font-semibold text-stone-800">{s.title}</div>
                  <div className="text-sm text-stone-600 mt-1">{s.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 mb-8">
          {FAQ.map((item, i) => (
            <div key={item.q} className="border border-stone-200 rounded-xl overflow-hidden">
              <button
                type="button"
                className="w-full text-left px-4 py-3 text-sm font-medium text-stone-700 flex justify-between"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {item.q}
                <span>{openFaq === i ? '▼' : '▶'}</span>
              </button>
              {openFaq === i && <div className="px-4 pb-3 text-sm text-stone-600">{item.a}</div>}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" className={simpleTheme.primaryBtn} onClick={onClose}>
            我学会了，返回
          </button>
          {onRedownload && (
            <button type="button" className={`${simpleTheme.secondaryBtn} w-full text-center`} onClick={onRedownload}>
              再下载一次
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
