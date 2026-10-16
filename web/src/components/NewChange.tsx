import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { DecisionCard } from './DecisionCard';

interface Props {
  disabled: boolean;
  aiAvailable: boolean;
  defaultTrack?: 'auto' | 'small' | 'feature';
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onDone: () => void;
}

type Track = 'auto' | 'small' | 'feature';

/**
 * 描述一个改动（§5.2）：Claude Code 可用时由它判断档位（只要会新增或改变用户可见行为，就是新功能档），
 * 需求会触及 ≥ 2 个功能时建议先拆成计划（§5.5）；你也可以坚持作为单个改动。
 */
export function NewChange({ disabled, aiAvailable, defaultTrack, act, onDone }: Props) {
  const [description, setDescription] = useState('');
  const [track, setTrack] = useState<Track>(defaultTrack ?? (aiAvailable ? 'auto' : 'small'));
  const [suggest, setSuggest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosenTrack = track === 'auto' ? undefined : track;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      const r = await api.createChange(description, chosenTrack);
      if ('suggestPlan' in r) setSuggest(r.rationale || '这个需求会触及多个功能');
      else {
        setDescription('');
        onDone();
      }
    });
    setBusy(false);
  };

  return (
    <section className="card" aria-label="描述一个改动" id="new-change">
      <h2 className="section-title">描述一个改动</h2>
      <form className="new-change" onSubmit={submit}>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如：登录加验证码 / 把按钮改成蓝色" disabled={disabled || busy} />
        <div className="track-choice" role="radiogroup" aria-label="档位">
          {aiAvailable && (
            <label className={track === 'auto' ? 'chosen' : ''}>
              <input type="radio" checked={track === 'auto'} onChange={() => setTrack('auto')} disabled={disabled} />
              让 AI 判断 <span className="muted">之后可以升档 / 降档</span>
            </label>
          )}
          <label className={track === 'small' ? 'chosen' : ''}>
            <input type="radio" checked={track === 'small'} onChange={() => setTrack('small')} disabled={disabled} />
            小改动 <span className="muted">只跑全量回归</span>
          </label>
          <label className={track === 'feature' ? 'chosen' : ''}>
            <input type="radio" checked={track === 'feature'} onChange={() => setTrack('feature')} disabled={disabled} />
            新功能 <span className="muted">先确认例子再实现</span>
          </label>
        </div>
        <button className="btn btn-primary" disabled={disabled || busy || !description.trim()}>
          {busy ? (track === 'auto' ? 'AI 判断中…' : '创建中…') : '开始改动'}
        </button>
      </form>
      <p className="muted small">
        {aiAvailable
          ? '小改动会直接交给 Claude Code 实现并跑全量回归；新功能会先让它起草验收例子。'
          : 'Claude Code 不可用：可以自己或用 Cursor 修改，Stagent 负责检查与合并门。'}
      </p>
      {suggest && (
        <DecisionCard
          cardId="suggest-plan"
          question="先拆成计划？"
          background={`${suggest}。作为一个改动做，会变成一次改很多文件、配很多例子的巨型合并，你很难逐段验收。`}
          options={[
            {
              label: '拆成计划',
              recommended: true,
              pros: '每步单独验收，合并后系统都可用',
              onChoose: () =>
                act(async () => {
                  await api.draftPlan(description);
                  setSuggest(null);
                  setDescription('');
                  window.location.hash = '#/plans';
                }),
            },
            {
              label: '坚持作为单个改动',
              cons: '验收粒度大',
              onChoose: () =>
                act(async () => {
                  await api.createChange(description, chosenTrack, true);
                  setSuggest(null);
                  setDescription('');
                  onDone();
                }),
            },
          ]}
        />
      )}
    </section>
  );
}
