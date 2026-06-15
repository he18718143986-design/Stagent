/**
 * Structured Task Brief schema (first slice, dead-code-safe, no wiring).
 *
 * A Task Brief captures the *pre-execution intent contract* for a task:
 * the main goal, explicit non-goals, boundaries/constraints, and acceptance
 * criteria. It complements (does not duplicate) Definition of Done, which is a
 * *post-execution* completion judgment (deliverable files exist + smoke).
 */

export interface TaskBrief {
  /** Main goal (required). */
  goal: string;
  /** Things explicitly out of scope. */
  nonGoals: string[];
  /** Boundaries / constraints (tech stack, scope, forbidden items). */
  boundaries: string[];
  /** Acceptance criteria (verifiable clauses). */
  acceptance: string[];
}

export type ScopeFindingKind = 'non-goal-touched' | 'boundary-violated';

export interface ScopeFinding {
  kind: ScopeFindingKind;
  term: string;
  detail: string;
}

export interface TaskBriefValidation {
  ok: boolean;
  issues: string[];
}
