function escapeHtmlShared(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** autoAI：无 webview l10n 时回退为英文键名。 */
function resolveWebviewString(key: string, ...args: (string | number)[]): string {
  const templates: Record<string, string> = {
    'stagent.webview.plan.dagLinearNoDeps': 'Linear (no explicit deps)',
    'stagent.webview.plan.dagWave': 'DAG waves',
    'stagent.webview.plan.linearOrder': 'Linear order',
    'stagent.webview.plan.dagLegend': ' · ',
    'stagent.webview.plan.dagPending': 'Pending',
    'stagent.webview.plan.dagActive': 'Active',
    'stagent.webview.plan.dagDone': 'Done',
    'stagent.webview.plan.dagPaused': 'Paused',
    'stagent.webview.plan.dagStep': 'Step {0}',
    'stagent.webview.plan.dagWaveN': 'Wave {0}',
    'stagent.webview.plan.dagNoEdges': 'No explicit edges',
    'stagent.webview.plan.dagDeps': 'Dependencies: ',
  };
  let text = templates[key] ?? key;
  args.forEach((a, i) => {
    text = text.replace(`{${i}}`, String(a));
  });
  return text;
}
import { resolveEffectiveEnableDagScheduler } from './EffectiveSettings';
import type { Stage, WorkflowDefinition } from './WorkflowDefinition';
import { getStageDependencyIds } from './WorkflowDag';

export interface DagGraphNode {
  stageId: string;
  title: string;
  wave: number;
  /** 线性模式下等于 stages[] 下标；DAG 模式下为拓扑波次内序号。 */
  orderInWave: number;
}

export interface DagGraphEdge {
  from: string;
  to: string;
}

export interface WorkflowDagGraphModel {
  mode: 'linear' | 'dag';
  nodes: DagGraphNode[];
  edges: DagGraphEdge[];
  waves: DagGraphNode[][];
}

function stripPhasePrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function hasExplicitDependencies(stages: Stage[]): boolean {
  return stages.some((s) => {
    const deps = getStageDependencyIds(s);
    return deps.length > 0;
  });
}

export function workflowUsesDagScheduling(definition: Pick<WorkflowDefinition, 'globalConfig' | 'stages'>): boolean {
  return resolveEffectiveEnableDagScheduler(definition.globalConfig);
}

/** 是否应在确认/执行页展示依赖图（显式 dependsOn / stage-output 或已开 DAG）。 */
export function shouldShowWorkflowDagGraph(definition: Pick<WorkflowDefinition, 'globalConfig' | 'stages'>): boolean {
  if (workflowUsesDagScheduling(definition)) {
    return true;
  }
  const stages = definition.stages ?? [];
  return stages.length > 1 && hasExplicitDependencies(stages);
}

/** 构建拓扑波次 + 边；无显式依赖时按 stages[] 线性单列展示。 */
export function buildWorkflowDagGraphModel(stages: Stage[]): WorkflowDagGraphModel {
  if (stages.length === 0) {
    return { mode: 'linear', nodes: [], edges: [], waves: [] };
  }

  const edges: DagGraphEdge[] = [];
  const idSet = new Set(stages.map((s) => s.id));
  for (const s of stages) {
    for (const dep of getStageDependencyIds(s)) {
      if (idSet.has(dep) && dep !== s.id) {
        edges.push({ from: dep, to: s.id });
      }
    }
  }

  const explicit = edges.length > 0 || stages.some((s) => (s.dependsOn?.length ?? 0) > 0);
  if (!explicit) {
    const nodes = stages.map((s, i) => ({
      stageId: s.id,
      title: stripPhasePrefix(s.title),
      wave: i,
      orderInWave: 0,
    }));
    const waves = nodes.map((n) => [n]);
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({ from: nodes[i].stageId, to: nodes[i + 1].stageId });
    }
    return { mode: 'linear', nodes, edges, waves };
  }

  const waveById = new Map<string, number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of stages) {
      const deps = getStageDependencyIds(s).filter((d) => idSet.has(d));
      const w = deps.length === 0 ? 0 : Math.max(...deps.map((d) => (waveById.get(d) ?? -1) + 1));
      const prev = waveById.get(s.id);
      if (prev !== w) {
        waveById.set(s.id, w);
        changed = true;
      }
    }
  }

  const maxWave = Math.max(...stages.map((s) => waveById.get(s.id) ?? 0));
  const waves: DagGraphNode[][] = [];
  for (let w = 0; w <= maxWave; w++) {
    waves.push([]);
  }
  const nodes: DagGraphNode[] = [];
  stages.forEach((s) => {
    const wave = waveById.get(s.id) ?? 0;
    const orderInWave = waves[wave].length;
    const node: DagGraphNode = {
      stageId: s.id,
      title: stripPhasePrefix(s.title),
      wave,
      orderInWave,
    };
    nodes.push(node);
    waves[wave].push(node);
  });
  // 稳定排序：同波内保持 stages[] 原序
  waves.forEach((waveNodes, w) => {
    waveNodes.sort((a, b) => {
      const ia = stages.findIndex((s) => s.id === a.stageId);
      const ib = stages.findIndex((s) => s.id === b.stageId);
      return ia - ib;
    });
    waveNodes.forEach((n, i) => {
      n.orderInWave = i;
    });
  });

  return { mode: 'dag', nodes, edges, waves: waves.filter((w) => w.length > 0) };
}

export type DagNodeVisualStatus = 'pending' | 'ready' | 'active' | 'done' | 'skipped' | 'error' | 'paused';

export interface BuildDagGraphHtmlOptions {
  statusByStageId?: Record<string, DagNodeVisualStatus | string>;
  highlightStageIds?: string[];
  onNodeClickStageId?: boolean;
}

/** 确认页 / 执行页共用的依赖图 HTML（纯字符串，供 webview innerHTML）。 */
export function buildWorkflowDagGraphHtml(
  stages: Stage[],
  globalConfig: WorkflowDefinition['globalConfig'] | undefined,
  escape: (s: string) => string = (s) => escapeHtmlShared(s),
  opts: BuildDagGraphHtmlOptions = {},
): string {
  if (!shouldShowWorkflowDagGraph({ stages, globalConfig })) {
    return '';
  }
  const model = buildWorkflowDagGraphModel(stages);
  const dagOn = workflowUsesDagScheduling({ stages, globalConfig });
  const modeLabel = dagOn
    ? model.mode === 'linear'
      ? resolveWebviewString('stagent.webview.plan.dagLinearNoDeps')
      : resolveWebviewString('stagent.webview.plan.dagWave')
    : resolveWebviewString('stagent.webview.plan.linearOrder');

  const legend =
    '<div class="dag-legend muted">' +
    escape(modeLabel) +
    resolveWebviewString('stagent.webview.plan.dagLegend') +
    '<span class="dag-node dag-node-pending">' +
    escape(resolveWebviewString('stagent.webview.plan.dagPending')) +
    '</span> ' +
    '<span class="dag-node dag-node-active">' +
    escape(resolveWebviewString('stagent.webview.plan.dagActive')) +
    '</span> ' +
    '<span class="dag-node dag-node-done">' +
    escape(resolveWebviewString('stagent.webview.plan.dagDone')) +
    '</span> ' +
    '<span class="dag-node dag-node-paused">' +
    escape(resolveWebviewString('stagent.webview.plan.dagPaused')) +
    '</span></div>';

  let wavesHtml = '<div class="dag-waves">';
  model.waves.forEach((waveNodes, wi) => {
    const label =
      model.mode === 'linear'
        ? resolveWebviewString('stagent.webview.plan.dagStep', wi + 1)
        : resolveWebviewString('stagent.webview.plan.dagWaveN', wi + 1);
    wavesHtml += '<div class="dag-wave"><div class="dag-wave-label">' + escape(label) + '</div><div class="dag-wave-nodes">';
    for (const n of waveNodes) {
      const status = opts.statusByStageId?.[n.stageId] ?? 'pending';
      const highlight = opts.highlightStageIds?.includes(n.stageId) ? ' dag-node-highlight' : '';
      const clickable = opts.onNodeClickStageId ? ' dag-node-clickable' : '';
      wavesHtml +=
        '<div class="dag-node dag-node-' +
        escape(String(status)) +
        highlight +
        clickable +
        '" data-stage-id="' +
        escape(n.stageId) +
        '" title="' +
        escape(n.stageId) +
        '">' +
        escape(n.title) +
        '</div>';
    }
    wavesHtml += '</div></div>';
    if (wi < model.waves.length - 1) {
      wavesHtml += '<div class="dag-wave-arrow" aria-hidden="true">→</div>';
    }
  });
  wavesHtml += '</div>';

  const edgeLines =
    model.edges.length > 0
      ? model.edges.map((e) => escape(e.from) + ' → ' + escape(e.to)).join('；')
      : resolveWebviewString('stagent.webview.plan.dagNoEdges');
  const edgesHtml =
    '<div class="dag-edges muted">' + escape(resolveWebviewString('stagent.webview.plan.dagDeps')) + edgeLines + '</div>';

  return '<div class="dag-graph">' + legend + wavesHtml + edgesHtml + '</div>';
}
