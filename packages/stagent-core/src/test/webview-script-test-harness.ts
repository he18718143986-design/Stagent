import * as assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { buildWorkflowWebviewHtml } from '../WebviewPanel';

export class MiniElement {
  public id = '';
  public tagName: string;
  public children: MiniElement[] = [];
  public parent: MiniElement | null = null;
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public className = '';
  public textContent = '';
  public value = '';
  public type = '';
  public placeholder = '';
  public disabled = false;
  public onclick: ((e?: unknown) => void) | null = null;
  public oninput: (() => void) | null = null;
  private inputListeners: Array<() => void> = [];

  addEventListener(event: string, handler: () => void): void {
    if (event === 'input') {
      this.inputListeners.push(handler);
    }
  }

  private innerHtmlBacking = '';

  /** Webview 脚本用 innerHTML 清空容器；必须 detach 子节点，否则会重复堆积 input。 */
  set innerHTML(v: string) {
    this.innerHtmlBacking = v;
    for (const c of [...this.children]) {
      c.remove();
    }
    if (!v.trim()) {
      return;
    }
    const strongMatch = /^<strong>([^]*)<\/strong>\s*$/i.exec(v.trim());
    if (strongMatch) {
      const s = new MiniElement('strong');
      s.textContent = strongMatch[1];
      this.appendChild(s);
    }
  }

  get innerHTML(): string {
    return this.innerHtmlBacking;
  }
  public classList = {
    toggle: (name: string, enabled?: boolean) => {
      const parts = this.className.split(/\s+/).filter(Boolean);
      const has = parts.includes(name);
      const on = enabled !== undefined ? enabled : !has;
      if (on && !has) {
        parts.push(name);
      } else if (!on) {
        this.className = parts.filter((c) => c !== name).join(' ');
        return;
      }
      this.className = parts.join(' ');
    },
    add: (name: string) => {
      if (!this.className.split(/\s+/).includes(name)) {
        this.className = this.className ? `${this.className} ${name}` : name;
      }
    },
    remove: (name: string) => {
      this.className = this.className
        .split(/\s+/)
        .filter((c) => c && c !== name)
        .join(' ');
    },
  };

  scrollIntoView(_opts?: unknown): void {}

  scrollTop = 0;

  get scrollHeight(): number {
    return 0;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  appendChild(child: MiniElement): MiniElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  querySelector(selector: string): MiniElement | null {
    if (selector.startsWith('.') && selector.length > 1) {
      const cls = selector.slice(1);
      return this.findFirst((node) => node.className.split(/\s+/).includes(cls));
    }
    if (selector === '.q-panel') {
      return this.findFirst((node) => node.className.split(' ').includes('q-panel'));
    }
    return null;
  }

  querySelectorAll(selector: string): MiniElement[] {
    if (selector === '.q-panel input[type=checkbox]') {
      const panel = this.querySelector('.q-panel');
      if (!panel) return [];
      return panel.findAll((node) => node.tagName === 'input' && node.type === 'checkbox');
    }
    return [];
  }

  private findFirst(predicate: (node: MiniElement) => boolean): MiniElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.findFirst(predicate);
      if (nested) return nested;
    }
    return null;
  }

  private findAll(predicate: (node: MiniElement) => boolean): MiniElement[] {
    const out: MiniElement[] = [];
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      out.push(...child.findAll(predicate));
    }
    return out;
  }
}

export class MiniDocument {
  private readonly byId = new Map<string, MiniElement>();

  register(el: MiniElement, id: string): void {
    el.id = id;
    this.byId.set(id, el);
  }

  getElementById(id: string): MiniElement | null {
    return this.byId.get(id) ?? null;
  }

  createElement(tag: string): MiniElement {
    return new MiniElement(tag);
  }
}

export function findButtonByText(root: MiniElement, text: string): MiniElement {
  const queue: MiniElement[] = [root];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.tagName === 'button' && n.textContent === text) {
      return n;
    }
    queue.push(...n.children);
  }
  throw new Error(`button not found: ${text}`);
}

export function findInputByPlaceholder(root: MiniElement, placeholderPrefix: string): MiniElement {
  const queue: MiniElement[] = [root];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.tagName === 'input' && n.placeholder.startsWith(placeholderPrefix)) {
      return n;
    }
    queue.push(...n.children);
  }
  throw new Error(`input not found: ${placeholderPrefix}`);
}

export function findFirstByTag(root: MiniElement, tagName: string): MiniElement {
  const queue: MiniElement[] = [root];
  const wanted = tagName.toLowerCase();
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.tagName === wanted) {
      return n;
    }
    queue.push(...n.children);
  }
  throw new Error(`element not found by tag: ${tagName}`);
}

export function findElementContainingText(root: MiniElement, text: string): MiniElement {
  const queue: MiniElement[] = [root];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if ((n.textContent || '').includes(text)) {
      return n;
    }
    queue.push(...n.children);
  }
  throw new Error(`element text not found: ${text}`);
}

/** 追问卡片内的单行文本输入（执行前 / 执行后批量表单）。 */
export function collectTextInputs(root: MiniElement): MiniElement[] {
  const out: MiniElement[] = [];
  const queue: MiniElement[] = [root];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.tagName === 'input' && n.type === 'text') {
      out.push(n);
    }
    queue.push(...n.children);
  }
  return out;
}

export function setupWebviewScriptRuntime(confirmResult: boolean) {
  const html = buildWorkflowWebviewHtml({ cspSource: 'vscode-test' } as never);
  const scriptMatch = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch?.[1], 'failed to extract webview script');
  const script = scriptMatch[1];

  const document = new MiniDocument();
  const ids = [
    'view-input',
    'view-confirm',
    'view-exec',
    'user-input',
    'polish-hint',
    'btn-polish',
    'task-workspace-path',
    'btn-pick-workspace',
    'btn-gen',
    'input-actions',
    'chat-history',
    'input-chat-shell',
    'composer-dock',
    'user-message-bubble',
    'input-composer',
    'polish-assistant',
    'polish-result-edit',
    'polish-loading',
    'polish-loading-text',
    'polish-inline-error',
    'btn-polish-apply',
    'btn-polish-collapse',
    'btn-edit-message',
    'gen-stream-details',
    'gen-status-panel',
    'gen-status-spinner',
    'gen-status-title',
    'gen-status-detail',
    'gen-stream',
    'timeline',
    'detail',
    'wf-warn',
    'plan-summary',
    'plan-diff',
    'plan-artifacts',
    'plan-stage-cards',
    'confirm-block',
    'confirm-footer',
    'confirm-stats',
    'confirm-main',
    'timeline-exec',
    'exec-main',
    'output-label',
    'btn-copy-debug',
    'output',
    'pause-bar',
    'downstream-reset-panel',
    'done-banner',
    'fail-banner',
  ];
  ids.forEach((id) => document.register(new MiniElement('div'), id));
  document.register(new MiniElement('button'), 'btn-start');
  document.register(new MiniElement('button'), 'btn-back-input');
  document.register(new MiniElement('button'), 'btn-regenerate');

  const postMessages: unknown[] = [];
  let messageHandler: ((event: { data: unknown }) => void) | null = null;

  const sandbox = {
    document,
    window: {
      addEventListener: (name: string, handler: (event: { data: unknown }) => void) => {
        if (name === 'message') messageHandler = handler;
      },
      requestAnimationFrame: (fn: () => void) => {
        fn();
        return 0;
      },
    },
    acquireVsCodeApi: () => ({
      postMessage: (msg: unknown) => {
        postMessages.push(msg);
      },
    }),
    confirm: () => confirmResult,
    alert: () => {},
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 0;
    },
  };
  vm.runInNewContext(script, sandbox);
  assert.ok(messageHandler, 'message handler not registered');

  return {
    document,
    postMessages,
    send: (data: unknown) => messageHandler!({ data }),
  };
}
