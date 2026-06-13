import type { CommitmentSnapshot } from './types';

export function formatCommitmentIndex(snapshot: CommitmentSnapshot): string {
  if (snapshot.commitments.length === 0) {
    return '';
  }
  const lines = snapshot.commitments.map(
    (c) => `- [${c.kind}] ${c.subject} (conf=${c.confidence.toFixed(2)})`,
  );
  return ['【机读承诺 CommitmentSnapshot】', ...lines].join('\n');
}
