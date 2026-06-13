import * as fs from 'node:fs';
import { resolveWebviewUiCatalogPath } from './webviewUiCatalogPath';
import { WEBVIEW_UI_KEYS } from './webviewUiKeyList';

type WebviewUiLocaleEntry = { en: string; zh: string };

let enCatalogCache: Record<string, WebviewUiLocaleEntry> | null = null;

function loadEnCatalog(): Record<string, WebviewUiLocaleEntry> {
  if (!enCatalogCache) {
    enCatalogCache = JSON.parse(fs.readFileSync(resolveWebviewUiCatalogPath(), 'utf8')) as Record<
      string,
      WebviewUiLocaleEntry
    >;
  }
  return enCatalogCache;
}

function translateKey(key: string, catalog: Record<string, WebviewUiLocaleEntry>): string {
  return catalog[key]?.en ?? key;
}

/** Build flat l10n map for webview injection (`window.__stagentL10n`). */
export function getWebviewUiStrings(): Record<string, string> {
  const catalog = loadEnCatalog();
  const out: Record<string, string> = {};
  for (const key of WEBVIEW_UI_KEYS) {
    out[key] = translateKey(key, catalog);
  }
  return out;
}
