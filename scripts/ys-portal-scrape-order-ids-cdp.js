#!/usr/bin/env node
/**
 * YS Partner Portal → Siparişler sekmesinden order_id (UUID) toplar.
 * Çıktı: data/ys-portal-order-ids.txt
 *
 *   node scripts/ys-portal-scrape-order-ids-cdp.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { paths } from '../lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2';
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR || path.join(os.tmpdir(), 'petfix-chrome-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const CHAIN_ID = '24fbaadf-e4d9-4040-87ce-7fa93ff26a19';
const ORDERS_URL = `https://partner-app.yemeksepeti.com/shops-integrations/chain/${CHAIN_ID}?updates_list_subview=orders&updates_list_selectedTab=1`;

const scrapeJs = `(async function(){
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const uuid = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi;
  const collect = () => {
    const text = document.body?.innerText || '';
    return [...new Set(text.match(uuid) || [])];
  };
  const link = [...document.querySelectorAll('a,button,span,div')]
    .find(el => /^siparis gecmisi$/i.test((el.textContent || '').trim()) || /^order history$/i.test((el.textContent || '').trim()));
  if (link) { link.click(); await sleep(5000); }
  return {
    url: location.href,
    loggedIn: !/\\/login/i.test(location.pathname),
    uuids: collect(),
    title: document.title
  };
})()`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 60000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 1) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.result?.result?.value);
      }
    });
    ws.onerror = reject;
  });
}

async function main() {
  try {
    execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
  } catch { /* */ }

  await sleep(1000);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    ORDERS_URL
  ], { stdio: 'ignore', detached: true });
  chrome.unref();

  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      if (i === 24) throw new Error('CDP bağlantısı kurulamadı');
    }
  }

  await sleep(8000);
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const tab = tabs.find((t) => t.url?.includes('yemeksepeti.com')) || tabs[0];
  const result = await cdpEvaluate(tab, scrapeJs);

  if (!result?.loggedIn) {
    console.error('YS oturumu gerekli — otomasyon Chrome penceresinde giriş yapın.');
    process.exit(2);
  }

  const outPath = path.join(paths.root, 'data', 'ys-portal-order-ids.txt');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${(result.uuids || []).join('\n')}\n`);

  console.log(JSON.stringify({
    ok: true,
    outPath,
    uuidCount: (result.uuids || []).length,
    uuids: result.uuids,
    orderCodesSample: result.orderCodes,
    url: result.url
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
