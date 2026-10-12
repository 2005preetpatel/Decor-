/* Minimal Chrome DevTools Protocol driver for the end-to-end checks.
   Needs Google Chrome (set CHROME to its path if it is not in the default
   Windows location). No npm packages. */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 900, port = 9400 + Math.floor(Math.random() * 400), mobile = false } = {}) {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0; const pending = new Map(); const handlers = new Map(); const logs = []; const csp = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    if (m.method === 'Log.entryAdded' && /Content Security Policy|Refused to|violates/i.test(m.params.entry.text)) csp.push(m.params.entry.text.slice(0, 220));
    (handlers.get(m.method) || []).forEach((h) => h(m.params));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, fn) => { handlers.set(method, [...(handlers.get(method) || []), fn]); };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

  const page = {
    send, on, logs, csp,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error('page eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    },
    async goto(url, wait = 3500) { await send('Page.navigate', { url }); await sleep(wait); },
    async shot(file, fs) {
      const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
      fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
    },
    /* Serve different bytes for a URL (used to inject a test config.js), and/or
       add response headers to another (used to apply the real Content-Security-
       Policy from vercel.json to the admin page).
         replace:    [{ part, body, type }]
         addHeaders: [{ part, headers: { Name: 'value' } }]                     */
    async intercept({ replace = [], addHeaders = [] }) {
      const patterns = [
        ...replace.map((r) => ({ urlPattern: '*' + r.part + '*', requestStage: 'Request' })),
        ...addHeaders.map((r) => ({ urlPattern: '*' + r.part + '*', requestStage: 'Response' })),
      ];
      await send('Fetch.enable', { patterns });
      on('Fetch.requestPaused', async (p) => {
        const url = p.request.url;
        const rep = !p.responseStatusCode && replace.find((r) => url.includes(r.part));
        if (rep) {
          return send('Fetch.fulfillRequest', {
            requestId: p.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: rep.type || 'text/javascript' }, { name: 'Cache-Control', value: 'no-store' }],
            body: Buffer.from(rep.body).toString('base64'),
          });
        }
        const add = p.responseStatusCode && addHeaders.find((r) => url.includes(r.part));
        if (add) {
          const b = await send('Fetch.getResponseBody', { requestId: p.requestId });
          const headers = (p.responseHeaders || []).filter((h) => !(h.name in add.headers) && !(h.name.toLowerCase() in Object.fromEntries(Object.keys(add.headers).map((k) => [k.toLowerCase(), 1]))));
          Object.entries(add.headers).forEach(([name, value]) => headers.push({ name, value }));
          return send('Fetch.fulfillRequest', {
            requestId: p.requestId, responseCode: p.responseStatusCode, responseHeaders: headers,
            body: b.result.base64Encoded ? b.result.body : Buffer.from(b.result.body).toString('base64'),
          });
        }
        return send('Fetch.continueRequest', { requestId: p.requestId });
      });
    },
    async replace(part, body, type) { return page.intercept({ replace: [{ part, body, type }] }); },
    /* Give a file input real files (paths on this computer). */
    async setFiles(selector, files) {
      const doc = await send('DOM.getDocument', { depth: -1 });
      const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
      await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files });
    },
    async scrollTo(y, wait = 1400) {
      await page.eval(`document.documentElement.style.scrollBehavior='auto';scrollTo(0,${Math.round(y)});1`);
      await sleep(wait);
    },
    async close() { try { ws.close(); } catch (e) { /* ignore */ } proc.kill(); },
  };
  return page;
}

let failed = 0;
export function check(name, cond, extra) {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '   ' + JSON.stringify(extra)));
  if (!cond) failed++;
}
export const failures = () => failed;
