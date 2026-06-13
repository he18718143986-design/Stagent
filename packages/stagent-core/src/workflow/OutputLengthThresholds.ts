export const OUTPUT_MIN_LEN_DECISION = 120;
export const OUTPUT_MIN_LEN_IMPL = 40;
export const OUTPUT_MIN_LEN_TEST = 20;
export const OUTPUT_MIN_LEN_OTHER = 15;
export const OUTPUT_MIN_LEN_NON_CODE_ARTIFACT = 8;

export type OutputLengthStageKind = 'decision' | 'impl' | 'test' | 'other';

export function minOutputLengthForStageKind(kind: OutputLengthStageKind): number {
  switch (kind) {
    case 'decision':
      return OUTPUT_MIN_LEN_DECISION;
    case 'impl':
      return OUTPUT_MIN_LEN_IMPL;
    case 'test':
      return OUTPUT_MIN_LEN_TEST;
    default:
      return OUTPUT_MIN_LEN_OTHER;
  }
}
