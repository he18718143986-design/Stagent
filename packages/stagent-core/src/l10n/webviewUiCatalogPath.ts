import * as fs from 'node:fs';
import * as path from 'node:path';

/** Resolve `webview-ui-strings.json` for both `src/l10n` (tsc) and `out/l10n` (runtime). */
export function resolveWebviewUiCatalogPath(): string {
  const besideModule = path.join(__dirname, 'webview-ui-strings.json');
  if (fs.existsSync(besideModule)) {
    return besideModule;
  }
  return path.join(__dirname, '../../src/l10n/webview-ui-strings.json');
}
