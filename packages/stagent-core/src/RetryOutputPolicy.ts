export function resetOutputsForNonDecisionRetry(
  _previous: Record<string, unknown>,
): Record<string, unknown> {
  // Current contract: non-decision retry clears all stage outputs,
  // and downstream logic should rely on re-executed fresh outputs.
  return {};
}
