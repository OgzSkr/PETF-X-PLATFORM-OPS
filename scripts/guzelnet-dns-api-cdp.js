#!/usr/bin/env node
/**
 * Güzel.net — api.petfix.com.tr A kaydı (Chrome CDP, Profile 6 / oguzekremseker).
 *
 *   CHROME_PROFILE=Profile 6 node scripts/guzelnet-dns-api-cdp.js
 *   CHROME_RESYNC=1 CHROME_PROFILE=Profile 6 node scripts/guzelnet-dns-api-cdp.js
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertNotRealChromeUserDataDir,
  CHROME_USER_DATA_DIR,
  isGoogleChromeRunningAsync
} from '../lib/chrome-profile-guard.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 6';
const PROFILE = path.resolve(
  process.env.CHROME_AUTOMATION_DIR || path.join(os.tmpdir(), 'petfix-guzelnet-automation')
);
const CDP_PORT = Number(process.env.CDP_PORT || 9336);
const FORCE_RESYNC = process.env.CHROME_RESYNC === '1';
const API_IP = process.env.API_VPS_IP || '104.247.163.98';
const DOMAIN = 'petfix.com.tr';
const SUBDOMAIN = 'api';

const START_URLS = [
  'https://www.guzel.net.tr/clientarea.php?action=domains',
  'https://www.guzel.net.tr/clientarea.php',
  'https://www.guzelhosting.com/clientarea.php?action=domains'
];

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
  const src = JSON.parse(fs.readFileSync(srcStatePath, 'utf8'));
  const info = src?.profile?.info_cache?.[CHROME_PROFILE];
  if (!info) throw new Error(`Local State içinde ${CHROME_PROFILE} yok`);
  return {
    profile: {
      info_cache: { [CHROME_PROFILE]: info },
      last_used: CHROME_PROFILE
    }
  };
}

async function syncAutomationProfileCopy() {
  const srcProfile = path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE);
  const dstProfile = path.join(PROFILE, CHROME_PROFILE);
  if (!fs.existsSync(srcProfile)) {
    throw new Error(`Profil yok: ${srcProfile}`);
  }

  const chromeRunning = await isGoogleChromeRunningAsync();
  const dstExists = fs.existsSync(dstProfile);

  if (chromeRunning && !FORCE_RESYNC) {
    if (!dstExists) {
      throw new Error('Chrome açık — CHROME_RESYNC=1 ile profil kopyalayın veya Chrome\'u kapatın.');
    }
    console.log('Mevcut /tmp profil kopyası kullanılıyor.');
    return;
  }

  if (chromeRunning && FORCE_RESYNC) {
    throw new Error('CHROME_RESYNC=1 için önce normal Chrome\'u kapatın.');
  }

  fs.mkdirSync(PROFILE, { recursive: true });
  console.log(`Profil kopyalanıyor: ${CHROME_PROFILE}`);
  execSync(`rsync -a --delete "${srcProfile}/" "${dstProfile}/"`, { stdio: 'inherit' });
  fs.writeFileSync(path.join(PROFILE, 'Local State'), `${JSON.stringify(buildMinimalLocalState())}\n`);
}

function stopAutomationChromeOnly() {
  try {
    execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
  } catch {
    /* yok */
  }
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('evaluate timeout')), 120000);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      );
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
    const timeout = setTimeout(() => reject(new Error('navigate timeout')), 45000);
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

const automateJs = `(async function(){
  const API_IP = ${JSON.stringify(API_IP)};
  const DOMAIN = ${JSON.stringify(DOMAIN)};
  const SUB = ${JSON.stringify(SUBDOMAIN)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').trim().toLowerCase();

  const clickLink = (patterns) => {
    const links = Array.from(document.querySelectorAll('a, button, input[type=submit], [role=button]'));
    for (const re of patterns) {
      const el = links.find((a) => re.test(norm(a.innerText || a.textContent || a.value || '')));
      if (el) {
        el.click();
        return (el.innerText || el.textContent || el.value || '').trim().slice(0, 80);
      }
    }
    return null;
  };

  const setInput = (input, value) => {
    if (!input) return false;
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    native.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const steps = [];
  const bodyText = () => (document.body?.innerText || '').slice(0, 4000);

  if (
    document.querySelector('input[name=password]') &&
    !/alan adlar/i.test(bodyText()) &&
    !/hizmetlerim/i.test(bodyText()) &&
    (/login|giris|signin/i.test(location.pathname) || document.querySelector('input[name=username]'))
  ) {
    return { ok: false, reason: 'login_required', url: location.href, snippet: bodyText().slice(0, 500) };
  }

  // WHMCS domain list → petfix.com.tr
  if (!location.href.includes('domain') && !location.href.includes('dns') && !location.href.includes('cpanel')) {
    clickLink([/alan ad/i, /domain/i, /hizmetlerim/i, /services/i]);
    steps.push('open-domains');
    await sleep(3000);
  }

  clickLink([new RegExp(DOMAIN.replace('.', '\\\\.'), 'i'), /petfix/i]);
  steps.push('open-petfix');
  await sleep(3000);

  clickLink([/dns/i, /zone editor/i, /bölge/i, /nameserver/i, /yönet/i, /manage/i]);
  steps.push('open-dns');
  await sleep(4000);

  // cPanel Zone Editor iframe?
  const frames = [document, ...Array.from(document.querySelectorAll('iframe')).map((f) => {
    try { return f.contentDocument; } catch { return null; }
  }).filter(Boolean)];

  let added = false;
  for (const doc of frames) {
    if (!doc) continue;
    clickLink([/kayıt ekle/i, /add record/i, /add a record/i, /\\+ kayıt/i]);
    await sleep(1500);

    const selects = Array.from(doc.querySelectorAll('select'));
    for (const sel of selects) {
      const opt = Array.from(sel.options).find((o) => /^a$/i.test((o.value || o.text || '').trim()));
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        steps.push('select-A');
        break;
      }
    }

    const inputs = Array.from(doc.querySelectorAll('input:not([type=hidden]):not([type=checkbox])'));
    const nameInput = inputs.find((i) =>
      /name|host|ad|hostname|record/i.test(
        (i.name || '') + (i.id || '') + (i.placeholder || '') + (i.getAttribute('aria-label') || '')
      )
    );
    const valueInput = inputs.find((i) =>
      /address|value|ip|deger|değer|points to|hedef/i.test(
        (i.name || '') + (i.id || '') + (i.placeholder || '') + (i.getAttribute('aria-label') || '')
      )
    );

    if (nameInput && valueInput) {
      setInput(nameInput, SUB);
      setInput(valueInput, API_IP);
      steps.push('fill-fields');
      const saved = clickLink([/save/i, /kaydet/i, /add record/i]);
      steps.push(saved || 'save-click');
      await sleep(2500);
      added = true;
      break;
    }

    // Tek satır tablo formu
    const rowInputs = inputs.filter((i) => i.type === 'text' || i.type === 'number' || !i.type);
    if (rowInputs.length >= 2) {
      setInput(rowInputs[0], SUB);
      setInput(rowInputs[rowInputs.length - 1], API_IP);
      clickLink([/save/i, /kaydet/i, /add/i]);
      added = true;
      steps.push('fill-row');
      break;
    }
  }

  const text = bodyText();
  const alreadyExists = text.includes(SUB + '.' + DOMAIN) && text.includes(API_IP);

  return {
    ok: added || alreadyExists,
    alreadyExists,
    steps,
    url: location.href,
    title: document.title,
    snippet: text.slice(0, 1200)
  };
})()`;

async function main() {
  stopAutomationChromeOnly();
  await sleep(1000);
  await syncAutomationProfileCopy();

  console.log(`Güzel.net DNS otomasyon — ${CHROME_PROFILE} — port ${CDP_PORT}`);

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--profile-directory=${CHROME_PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      START_URLS[0]
    ],
    { stdio: 'ignore', detached: true }
  );
  chrome.unref();

  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      if (i === 29) {
        console.error('CDP bağlanamadı');
        process.exit(1);
      }
    }
  }

  await sleep(5000);
  let tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  let tab = tabs.find((t) => t.type === 'page') || tabs[0];

  let result = await cdpEvaluate(tab, automateJs);
  console.log('Deneme 1:', JSON.stringify(result, null, 2));

  if (result?.reason === 'login_required') {
    console.error('\nGüzel.net oturumu yok. Açılan Chrome penceresinde giriş yapın, sonra tekrar çalıştırın.');
    process.exit(2);
  }

  if (!result?.ok) {
    for (const url of START_URLS.slice(1)) {
      await cdpNavigate(tab, url);
      await sleep(5000);
      tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      tab = tabs.find((t) => t.type === 'page') || tabs[0];
      result = await cdpEvaluate(tab, automateJs);
      console.log(`Deneme ${url}:`, JSON.stringify(result, null, 2));
      if (result?.ok) break;
    }
  }

  if (!result?.ok) {
    console.error('\nDNS kaydı otomatik eklenemedi — açılan pencerede manuel kontrol gerekebilir.');
    process.exit(3);
  }

  console.log('\n✓ api.petfix.com.tr A kaydı eklendi (veya zaten vardı).');
  stopAutomationChromeOnly();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
