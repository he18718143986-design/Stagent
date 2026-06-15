/**
 * best-of-N gated selection — decoupled candidate outcome types.
 *
 * These types are intentionally independent of WorkflowInstance / the executor
 * so the selection policy stays a pure, isolated slice. Executor wiring (running
 * N samples, collecting candidates) is a later live slice and lives elsewhere.
 */

export interface CandidateOutcome {
  /** Candidate identifier (e.g. "attempt-1"). */
  id: string;
  /** Whether the candidate passed Strict QA (tests all green + smoke + gates). */
  passed: boolean;
  /** Optional 0..1 quality score, used to break ties between passing candidates. */
  qualityScore?: number;
  testsPassed?: number;
  testsFailed?: number;
  smokePassed?: boolean;
  gateViolations?: number;
  notes?: string[];
}

export interface BestOfNSelection {
  /** Selected candidate id, or null when no candidate passed Strict QA. */
  selectedId: string | null;
  reason: string;
  /** Candidates sorted best -> worst. */
  ranked: CandidateOutcome[];
}
