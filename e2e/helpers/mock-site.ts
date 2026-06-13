/**
 * A lightweight HTTP server that simulates an AI chat website.
 *
 * The page exposes the same DOM structure as the ChatGPT preset so the
 * existing injector + response-watcher code can drive it without any
 * site-specific changes.
 *
 * Selectors used (match the mock site's store config in seed-store.ts):
 *   input:    #ai-input  (plain textarea with explicit CSS size)
 *   send:     #ai-send
 *   response: .ai-message
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

/** HTML served by the mock AI site */
const MOCK_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mock AI</title>
  <style>
    /* Explicit pixel sizes ensure getBoundingClientRect() returns non-zero
       values even when the WebContentsView is at 0×0 bounds.              */
    body   { margin: 0; padding: 16px; font-family: sans-serif; }
    #ai-input  { width: 500px; height: 80px; display: block; }
    #ai-send   { width: 80px;  height: 36px; margin-top: 8px; cursor: pointer; }
    .ai-tool   { width: 120px; height: 30px; margin-top: 8px; cursor: pointer; }
    #ai-model-menu { display: none; }
    #ai-model-menu.open { display: block; }
    .ai-model-opt { display: block; width: 160px; height: 28px; cursor: pointer; }
    #ai-effort-menu { display: none; }
    #ai-effort-menu.open { display: block; }
    .ai-effort-opt { display: block; width: 160px; height: 28px; cursor: pointer; }
    .ai-message { padding: 8px; margin-top: 8px; background: #f0f0f0; }
  </style>
</head>
<body>
  <div id="chat-container">
    <!-- Initial assistant message so adjustedBeforeCount starts at 1 -->
    <div class="ai-message">Hello! I am a mock AI assistant.</div>
  </div>

  <textarea id="ai-input" placeholder="Type your message…"></textarea>
  <button id="ai-send">Send</button>
  <!-- M12: a one-click tool toggle whose on/off state is reflected by
       aria-pressed — mirrors DeepSeek's 深度思考 / 智能搜索 composer buttons. -->
  <button id="ai-tool-deepthink" class="ai-tool" aria-pressed="false">深度思考</button>

  <!-- M13: a fake model picker. The trigger opens the menu; clicking an option
       sets the current model. The send echo embeds the current model so the
       HTTP response proves whether the automation layer switched it. -->
  <button id="ai-model-btn">模型: <span id="ai-model-cur">m-fast</span></button>
  <div id="ai-model-menu">
    <button class="ai-model-opt" data-model="m-fast">Fast</button>
    <button class="ai-model-opt" data-model="m-pro">Pro</button>
    <!-- M13: an "Effort" submenu trigger living INSIDE the model picker, like
         Claude's Effort tier selector. Clicking it reveals the level buttons. -->
    <button id="ai-effort-trigger">Effort</button>
    <div id="ai-effort-menu">
      <button class="ai-effort-opt" data-effort="low">Low</button>
      <button class="ai-effort-opt" data-effort="medium">Medium</button>
      <button class="ai-effort-opt" data-effort="high">High</button>
      <button class="ai-effort-opt" data-effort="max">Max</button>
    </div>
  </div>

  <script>
    var msgCount = 1;
    var toolBtn = document.getElementById('ai-tool-deepthink');
    toolBtn.addEventListener('click', function () {
      var on = toolBtn.getAttribute('aria-pressed') === 'true';
      toolBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    });

    var currentModel = 'm-fast';
    var modelMenu = document.getElementById('ai-model-menu');
    document.getElementById('ai-model-btn').addEventListener('click', function () {
      modelMenu.classList.add('open');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ai-model-opt'), function (opt) {
      opt.addEventListener('click', function () {
        currentModel = opt.getAttribute('data-model');
        document.getElementById('ai-model-cur').textContent = currentModel;
        modelMenu.classList.remove('open');
      });
    });

    // M14(缺口2): when true the site ALWAYS reports quota exhaustion on send —
    // used to deterministically drive cross-account rotation in E2E.
    var ALWAYS_QUOTA = /*__ALWAYS_QUOTA__*/false;

    // M13: effort submenu — opens on the "Effort" trigger, sets currentEffort.
    var currentEffort = 'low';
    var effortMenu = document.getElementById('ai-effort-menu');
    document.getElementById('ai-effort-trigger').addEventListener('click', function () {
      effortMenu.classList.add('open');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ai-effort-opt'), function (opt) {
      opt.addEventListener('click', function () {
        currentEffort = opt.getAttribute('data-effort');
        effortMenu.classList.remove('open');
        modelMenu.classList.remove('open');
      });
    });

    document.getElementById('ai-send').addEventListener('click', function () {
      var text = document.getElementById('ai-input').value;
      if (!text.trim()) return;
      // Capture the tool + model state AT SEND TIME so the echo proves whether
      // the automation layer applied them before dispatching the prompt.
      var deepThinkOn = toolBtn.getAttribute('aria-pressed') === 'true';
      var modelAtSend = currentModel;
      var effortAtSend = currentEffort;
      // M14(缺口1): when the prompt asks for it, render a short quota banner
      // (NOT an .ai-message, and < 50 chars) so the response-watcher's parallel
      // checkQuota() — not its new-content detector — fires quotaExhausted.
      if (ALWAYS_QUOTA || text.indexOf('__QUOTA__') > -1) {
        setTimeout(function () {
          var banner = document.createElement('div');
          banner.id = 'quota-banner';
          banner.textContent = 'QUOTA_LIMIT_HIT';
          document.body.appendChild(banner);
        }, 600);
        return;
      }
      // Simulate a network delay LONGER than watchForReply's 800ms init wait.
      // watchForReply sets its baseline (adjustedBeforeCount) after 800ms.
      // If the echo arrives before 800ms, it's counted in the baseline and
      // watchForReply never detects a "new" element.  1200ms ensures the echo
      // appears AFTER the baseline is recorded.
      setTimeout(function () {
        var div = document.createElement('div');
        div.className = 'ai-message';
        // textContent is the ground truth; innerText is intentionally the same
        div.textContent = 'Echo: ' + text +
          ' [model=' + modelAtSend + ']' +
          ' [effort=' + effortAtSend + ']' +
          ' [deepThink=' + (deepThinkOn ? 'on' : 'off') + ']';
        document.getElementById('chat-container').appendChild(div);
        msgCount++;
      }, 1200);
    });
  </script>
</body>
</html>`

export interface MockServer {
  /** Base URL, e.g. "http://127.0.0.1:54321" */
  url: string
  /** Shut the server down */
  close: () => Promise<void>
}

export interface MockServerOptions {
  /** When true, every send reports quota exhaustion (drives rotation tests). */
  alwaysQuota?: boolean
}

/**
 * Starts the mock AI site server on a random port.
 * Returns the base URL and a close() function.
 */
export async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const html = MOCK_HTML.replace('/*__ALWAYS_QUOTA__*/false', opts.alwaysQuota ? 'true' : 'false')
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })

    server.on('error', reject)

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const url = `http://127.0.0.1:${port}`
      resolve({
        url,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}

/**
 * Starts a two-endpoint mock server that simulates a SPA doing a client-side
 * redirect away from the "logged-in" URL shortly after navigation.
 *
 * Endpoints:
 *   GET /         — the "chat" page (loggedInUrlPattern matches this)
 *   GET /verify   — a "email verification" page (must NOT be treated as logged in)
 *
 * The chat page's JS immediately navigates to /verify after 300ms, simulating
 * how ChatGPT redirects to auth.openai.com/email-verification when the account
 * has an unverified email — even though the URL briefly passes the pattern check.
 *
 * Used by: login detection URL-pattern redirect regression test.
 */
export async function startRedirectMockServer(): Promise<MockServer & { verifyUrl: string }> {
  const CHAT_HTML = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mock Chat</title></head>
<body>
  <div id="chat-root">
    <textarea id="ai-input" style="width:300px;height:60px"></textarea>
    <button id="ai-send" style="width:60px;height:30px">Send</button>
  </div>
  <script>
    // Simulate SPA redirect to email-verification after 300ms
    setTimeout(function() { window.location.pathname = '/verify'; }, 300);
  </script>
</body></html>`

  const VERIFY_HTML = /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Verify Email</title></head>
<body>
  <h1>Please verify your email</h1>
  <p>Check your inbox to continue.</p>
</body></html>`

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/verify') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(VERIFY_HTML)
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(CHAT_HTML)
      }
    })

    server.on('error', reject)

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const url = `http://127.0.0.1:${port}`
      resolve({
        url,
        verifyUrl: `${url}/verify`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}
