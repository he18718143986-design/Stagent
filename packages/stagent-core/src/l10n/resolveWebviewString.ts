import { uiMsg } from './uiStrings';

/** Host + webview bundle: prefer injected webview map, else VS Code l10n bundle. */
export function resolveWebviewString(key: string, ...args: Array<string | number>): string {
  const injected = (globalThis as { __stagentL10n?: Record<string, string> }).__stagentL10n?.[key];
  if (injected) {
    let text = injected;
    args.forEach((val, i) => {
      text = text.replace(new RegExp(`\\{${i}\\}`, 'g'), String(val));
    });
    return text;
  }
  return uiMsg(key, ...args);
}
