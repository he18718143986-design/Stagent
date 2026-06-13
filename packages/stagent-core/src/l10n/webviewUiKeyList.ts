import * as fs from 'node:fs';
import { resolveWebviewUiCatalogPath } from './webviewUiCatalogPath';

/** All `stagent.webview.*` keys merged into package.nls (see scripts/gen-webview-nls.mjs). */
export const WEBVIEW_UI_KEYS = Object.keys(
  JSON.parse(fs.readFileSync(resolveWebviewUiCatalogPath(), 'utf8')) as Record<string, unknown>,
) as string[];
