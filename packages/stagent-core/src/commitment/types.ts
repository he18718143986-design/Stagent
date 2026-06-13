export type CommitmentKind =
  | 'file_path'
  | 'export_symbol'
  | 'api_signature'
  | 'sdk_family'
  | 'test_layout'
  | 'dependency'
  | 'boundary'
  | 'assumption';

export type CommitmentSource = 'parser' | 'llm' | 'charter' | 'sidecar';

export interface Commitment {
  id: string;
  kind: CommitmentKind;
  subject: string;
  source: CommitmentSource;
  confidence: number;
  stageId: string;
}

export interface CommitmentSnapshot {
  stageId: string;
  recordHash: string;
  commitments: Commitment[];
  extractedAt: string;
  parserWarnings: string[];
}
