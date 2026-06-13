/* ------------------------------------------------------------------ */
/*  Global chat generation busy gate (M3: no concurrent sends)          */
/* ------------------------------------------------------------------ */

let busy = false

export function getChatBusy(): boolean {
  return busy
}

export function setChatBusy(next: boolean): void {
  busy = next
}

/** Clears busy — reply pipeline calls this in `.finally`. */
export function clearChatBusy(): void {
  busy = false
}
