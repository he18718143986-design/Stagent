const GLOBAL_STATE_RETRY_MS = 100;
const GLOBAL_STATE_MAX_ATTEMPTS = 3;

/** Options for globalState update operations with retry logic */
export interface GlobalStateUpdateOptions {
  maxAttempts?: number;
  delayMs?: number;
  onFailure?: (context: string, err: unknown) => void;
  onRetry?: (attempt: number, context: string) => void;
}

/**
 * Legacy fire-and-forget globalState update.
 * Deprecated: Use `globalStateUpdate()` instead for better error handling.
 */
export function voidGlobalStateUpdate(
  update: () => Promise<void>,
  warn: (message: string) => void,
  context: string,
  options?: GlobalStateUpdateOptions,
): void {
  voidGlobalStateUpdateWithRetry(update, warn, context, options);
}

/**
 * Legacy fire-and-forget globalState update with retry logic.
 * Deprecated: Use `globalStateUpdate()` instead for better error handling.
 */
export function voidGlobalStateUpdateWithRetry(
  update: () => Promise<void>,
  warn: (message: string) => void,
  context: string,
  options?: GlobalStateUpdateOptions,
): void {
  const maxAttempts = options?.maxAttempts ?? GLOBAL_STATE_MAX_ATTEMPTS;
  const delayMs = options?.delayMs ?? GLOBAL_STATE_RETRY_MS;
  void (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await update();
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts - 1) {
          options?.onRetry?.(attempt + 1, context);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    const err = lastErr instanceof Error ? lastErr.message : String(lastErr);
    warn(`global_state_update_failed context=${context} attempt=${maxAttempts} err=${err}`);
    options?.onFailure?.(context, lastErr);
  })();
}

/**
 * Improved globalState update with guaranteed return status.
 * 
 * @param update - The async function that updates globalState
 * @param context - Context identifier for logging
 * @param options - Optional configuration for retry behavior
 * @returns Promise<boolean> - true if update succeeded, false if all retries exhausted
 * 
 * @example
 * ```typescript
 * const success = await globalStateUpdate(
 *   () => vscode.workspace.getConfiguration().update('key', value),
 *   'save_instance_metadata'
 * );
 * 
 * if (!success) {
 *   // Handle persistence failure - escalate to HITL
 *   await hitlCoordinator.pauseWithQuestion({
 *     type: 'persistenceFailed',
 *     suggestion: 'retryOrManualSave',
 *   });
 * }
 * ```
 */
export async function globalStateUpdate(
  update: () => Promise<void>,
  context: string,
  options?: GlobalStateUpdateOptions,
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? GLOBAL_STATE_MAX_ATTEMPTS;
  const delayMs = options?.delayMs ?? GLOBAL_STATE_RETRY_MS;

  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await update();
      return true; // Success
    } catch (e) {
      lastErr = e;

      if (attempt < maxAttempts - 1) {
        options?.onRetry?.(attempt + 1, context);
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt))); // Exponential backoff
      }
    }
  }

  // All retries exhausted
  const err = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.error(
    `[stagent] global_state_update_failed: context=${context} attempts=${maxAttempts} error=${err}`
  );
  options?.onFailure?.(context, lastErr);

  return false;
}

/**
 * Batch update multiple globalState values atomically.
 * Fails if any single update fails.
 * 
 * @param updates - Array of {key, value} pairs to update
 * @param updateFn - Function that performs the actual update (usually workspace.getConfiguration().update)
 * @param context - Context identifier for logging
 * @returns Promise<boolean> - true if all updates succeeded
 */
export async function globalStateUpdateBatch(
  updates: Array<{ key: string; value: unknown }>,
  updateFn: (key: string, value: unknown) => Promise<void>,
  context: string,
  options?: GlobalStateUpdateOptions,
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? GLOBAL_STATE_MAX_ATTEMPTS;
  const delayMs = options?.delayMs ?? GLOBAL_STATE_RETRY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Execute all updates in sequence
      for (const { key, value } of updates) {
        await updateFn(key, value);
      }
      return true; // All succeeded
    } catch (e) {
      if (attempt < maxAttempts - 1) {
        options?.onRetry?.(attempt + 1, context);
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
      } else {
        const err = e instanceof Error ? e.message : String(e);
        console.error(
          `[stagent] global_state_batch_update_failed: context=${context} updates=${updates.length} attempts=${maxAttempts} error=${err}`
        );
        options?.onFailure?.(context, e);
        return false;
      }
    }
  }

  return false;
}
