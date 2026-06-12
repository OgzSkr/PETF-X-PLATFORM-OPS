#!/usr/bin/env node
/**
 * Portal → jk2w-2624-kvq0 siparişini bul, UUID çıkar.
 */
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2';
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR || path.join(os.tmpdir(), 'petfix-chrome-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const ORDER_CODE = process.env.YS_ORDER_CODE || 'jk2w-2624-kvq0';

const scrapeJs = `(async function(){
  const code = ${JSON.stringify(ORDER_CODE)};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const uuid = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
  const click = (re) => {
    const el = [...document.querySelectorAll('a,button,span,div,li')].find(e => re.test((e.textContent||'').trim()));
    if (el) { el.click(); return true; }
    return false;
  };
  click(/^anlik siparisler$/i) || click(/^anlık siparişler$/i) || click(/^siparis gecmisi$/i) || click(/^sipariş geçmişi$/i);
  await sleep(5000);
  const body = document.body?.innerText || '';
  const idx = body.indexOf(code);
  const snippet = idx >= 0 ? body.slice(Math.max(0, idx - 200), idx + 400) : body.slice(0, 800);
  const uuids = [...new Set(body.match(uuid) || [])];
  return { url: location.href, found: body.includes(code), snippet, uuids: uuids.slice(0, 20), title: document.title };
})()`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 90000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) { clearTimeout(t); ws.close(); resolve(msg.result?.result?.value); }
    });
    ws.onerror = reject;
  });
}

async function main() {
  try { execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' }); } catch { /* */ }
  await sleep(800);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    'https://partner-app.yemeksepeti.com/'
  ], { stdio: 'ignore', detached: true });
  chrome.unref();
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    try { await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch { if (i === 24) throw new Error('CDP fail'); }
  }
  await sleep(6000);
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const tab = tabs.find((t) => t.url?.includes('yemeksepeti')) || tabs[0];
  const result = await cdpEvaluate(tab, scrapeJs);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
