import type { PlatformAdapter } from '../platform/PlatformAdapter';

/** Thin UI adapter so pure-logic callers stay host-free and unit-testable. */
export type ConfirmDialog = (
  message: string,
  continueLabel: string,
  cancelLabel: string,
) => Promise<string | undefined>;

export function platformConfirmDialog(adapter: PlatformAdapter): ConfirmDialog {
  return (message, continueLabel, cancelLabel) =>
    adapter.notify.info(message, continueLabel, cancelLabel);
}
