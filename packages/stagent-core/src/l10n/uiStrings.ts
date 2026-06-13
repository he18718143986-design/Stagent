import * as fs from 'fs';
import * as path from 'path';

let nlsBundle: Record<string, string> | undefined;

function loadDefaultNlsBundle(): Record<string, string> {
  if (nlsBundle) {
    return nlsBundle;
  }
  try {
    const nlsPath = path.join(__dirname, '..', '..', 'package.nls.json');
    nlsBundle = JSON.parse(fs.readFileSync(nlsPath, 'utf-8')) as Record<string, string>;
  } catch {
    nlsBundle = {};
  }
  return nlsBundle;
}

function formatNlsTemplate(template: string, args: Array<string | number>): string {
  let out = template;
  for (let i = 0; i < args.length; i++) {
    out = out.replace(new RegExp(`\\{${i}\\}`, 'g'), String(args[i]));
  }
  return out;
}

export function uiMsg(key: string, ...args: Array<string | number>): string {
  const template = loadDefaultNlsBundle()[key];
  if (template) {
    return formatNlsTemplate(template, args);
  }
  if (args.length === 0) {
    return key;
  }
  return formatNlsTemplate(key, args);
}
