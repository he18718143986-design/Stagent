export type DiagnosticCategory = 'config' | 'symbol' | 'assertion' | 'semantic';

export type DiagnosticAction =
  | 'bootstrap'
  | 'gate_repair'
  | 'fix_chain'
  | 'reopen_decision'
  | 'escalate_confirm';

export interface DiagnosticRoute {
  category: DiagnosticCategory;
  action: DiagnosticAction;
  targetStageId?: string;
  reason: string;
}
