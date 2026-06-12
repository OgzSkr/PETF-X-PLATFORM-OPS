#!/usr/bin/env node
/**
 * YS Partner Portal → Shop Integrations → Vendor Identifier ekranından store ID okur.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  assertNotRealChromeUserDataDir,
  CHROME_USER_DATA_DIR,
  isGoogleChromeRunningAsync
} from '../lib/chrome-profile-guard.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2';
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR
  || path.join(os.tmpdir(), 'petfix-chrome-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const FORCE_RESYNC = process.env.CHROME_RESYNC === '1';
const CHAIN_ID = process.env.YEMEKSEPETI_CHAIN_ID || '24fbaadf-e4d9-4040-87ce-7fa93ff26a19';
const TARGET_URL = `https://partner-app.yemeksepeti.com/shops-integrations/chain/${CHAIN_ID}`;

assertNotRealChromeUserDataDir(PROFILE);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function buildMinimalLocalState() {
  const srcStatePath = path.join(CHROME_USER_DATA_DIR, 'Local State');
  if (!fs.existsSync(srcStatePath)) return { profile: { info_cache: {} } };
  const src = JSON.parse(fs.readFileSync(srcStatePath, 'utf8'));
  const info = src?.profile?.info_cache?.[CHROME_PROFILE];
  if (!info) throw new Error(`Local State içinde ${CHROME_PROFILE} kaydı yok.`);
  return { profile: { info_cache: { [CHROME_PROFILE]: info }, last_used: CHROME_PROFILE } };
}

async function syncAutomationProfileCopy() {
  const srcProfile = path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE);
  const dstProfile = path.join(PROFILE, CHROME_PROFILE);
  if (!fs.existsSync(srcProfile)) throw new Error(`Chrome profili bulunamadı: ${srcProfile}`);
  if (FORCE_RESYNC || !fs.existsSync(dstProfile)) {
    if (await isGoogleChromeRunningAsync()) {
      throw new Error('CHROME_RESYNC=1 için Google Chrome kapalı olmalı.');
    }
    fs.mkdirSync(PROFILE, { recursive: true });
    execSync(`rsync -a --delete "${srcProfile}/" "${dstProfile}/"`, { stdio: 'inherit' });
    fs.writeFileSync(path.join(PROFILE, 'Local State'), JSON.stringify(buildMinimalLocalState()));
  }
}

function stopAutomationChromeOnly() {
  try {
    execSync(`lsof -ti tcp:${CDP_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('evaluate timeout')), 90000);
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
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result?.result?.value);
      }
    });
    ws.addEventListener('error', reject);
  });
}

async function cdpNavigate(tab, url) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('navigate timeout')), 30000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
      ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: '1' } }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 2) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });
    ws.addEventListener('error', reject);
  });
}

const scrapeJs = `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const bodyText = document.body?.innerText || '';
  const ids = [];
  const patterns = [
    /store\\s*id\\s*[:\\-]?\\s*([a-z0-9_-]+)/gi,
    /mağaza\\s*id\\s*[:\\-]?\\s*([a-z0-9_-]+)/gi,
    /vendor\\s*identifier\\s*[:\\-]?\\s*([a-z0-9_-]+)/gi,
    /satıcı\\s*tanımlayıcı\\s*[:\\-]?\\s*([a-z0-9_-]+)/gi,
    /harici\\s*iş\\s*ortağı\\s*yapılandırma\\s*kimliği\\s*[:\\-]?\\s*([0-9]+)/gi,
    /external\\s*partner\\s*config\\s*id\\s*[:\\-]?\\s*([0-9]+)/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(bodyText)) !== null) ids.push(m[1]);
  }
  const inputs = Array.from(document.querySelectorAll('input,textarea,[data-testid]'));
  const fieldValues = inputs.map((el) => ({
    label: (el.closest('label')?.innerText || el.getAttribute('aria-label') || el.previousElementSibling?.innerText || '').slice(0, 80),
    value: (el.value || el.innerText || el.textContent || '').trim().slice(0, 120),
    placeholder: (el.placeholder || '').slice(0, 80)
  })).filter((row) => row.value || /store|vendor|mağaza|harici|external|config|id/i.test(row.label + row.placeholder));
  const codeBlocks = Array.from(document.querySelectorAll('code,pre,span')).map((el) => (el.innerText || '').trim()).filter((t) => /^[a-z0-9_-]{3,20}$/i.test(t) || /^\\d{6,}$/.test(t));
  return {
    url: location.href,
    loggedIn: !/\\/login/i.test(location.pathname),
    ids: [...new Set(ids)],
    fieldValues,
    codeBlocks: [...new Set(codeBlocks)].slice(0, 30),
    snippet: bodyText.slice(0, 2500)
  };
})()`;

async function findYsTab() {
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return tabs.find((t) => t.url?.includes('yemeksepeti.com')) || tabs[0];
}

async function main() {
  stopAutomationChromeOnly();
  await sleep(1500);
  await syncAutomationProfileCopy();

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    TARGET_URL
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

  await sleep(6000);
  let tab = await findYsTab();
  let status = await cdpEvaluate(tab, `({ href: location.href, loggedIn: !/\\/login/i.test(location.pathname) })`);
  if (!status?.loggedIn) {
    console.error(JSON.stringify({ ok: false, reason: 'login_required', url: status?.href }));
    process.exit(2);
  }

  if (!tab.url?.includes('shops-integrations')) {
    await cdpNavigate(tab, TARGET_URL);
    await sleep(6000);
    tab = await findYsTab();
  }

  // jk2w → Ayarlar → API / Vendor Identifier
  const navJs = `(() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    return (async () => {
      const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const clickBtn = (re) => {
        const btn = Array.from(document.querySelectorAll('button,a,[role=button]')).find((b) => re.test(norm(b.innerText)));
        if (btn) { btn.click(); return true; }
        return false;
      };
      const findChainAyarlar = () => {
        const row = Array.from(document.querySelectorAll('div,section,article,li,tr')).find((el) => {
          const text = el.innerText || '';
          return text.includes('jk2w') && text.includes('Ayarlar') && text.length < 400;
        });
        if (row) return Array.from(row.querySelectorAll('button')).find((b) => norm(b.innerText) === 'ayarlar') || null;
        return Array.from(document.querySelectorAll('button')).find((b) => norm(b.innerText) === 'ayarlar') || null;
      };
      const steps = [];
      const ayarlar = findChainAyarlar();
      if (ayarlar) { ayarlar.click(); steps.push('ayarlar'); await sleep(5000); }
      clickBtn(/^api'?si$|^api$/); steps.push('api'); await sleep(4000);
      clickBtn(/vendor identifier|satıcı tanımlayıcı|vendor id|mağaza/i); steps.push('vendor-id'); await sleep(3000);
      return { steps, url: location.href };
    })();
  })()`;

  const nav = await cdpEvaluate(tab, navJs);
  await sleep(2000);
  tab = await findYsTab();
  const scraped = await cdpEvaluate(tab, scrapeJs);
  console.log(JSON.stringify({ ok: true, nav, scraped }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
