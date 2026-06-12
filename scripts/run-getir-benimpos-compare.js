#!/usr/bin/env node
/**
 * Getir ↔ BenimPOS barkod karşılaştırmasını e-tabloya yazar (Cevizlibağ Chrome profili).
 *   node scripts/run-getir-benimpos-compare.js
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
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2';
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR
  || path.join(os.tmpdir(), 'petfix-sheets-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const SPREADSHEET_ID = '1P2HPmJrTEKLjmDcqYAQLmn1YnFijqEKmWEu21fxRreA';
const SCRIPT_EDIT_URL = process.env.APPS_SCRIPT_EDIT_URL
  || 'https://script.google.com/u/0/home/projects/1R537acmldatYF2nsvspJj7rIoU1YrDsVFzEUbStu7yf9u2pFwyM_8qI3/edit';

assertNotRealChromeUserDataDir(PROFILE);

const APPS_SCRIPT = `function compareGetirBenimposBarcodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const getir = ss.getSheetByName('Getir');
  const benimpos = ss.getSheetByName('BenimPOS');
  if (!getir || !benimpos) throw new Error('Getir veya BenimPOS sekmesi yok');
  let compare = ss.getSheetByName('Karşılaştır');
  if (!compare) compare = ss.insertSheet('Karşılaştır');
  compare.clear();
  const getirValues = getir.getDataRange().getDisplayValues();
  const benimposValues = benimpos.getDataRange().getDisplayValues();
  const getirCol = getirValues[0].findIndex(function(h) { return String(h).toLowerCase().indexOf('barkod') >= 0; });
  const benimposCol = benimposValues[0].findIndex(function(h) { return String(h).toLowerCase().indexOf('barkod') >= 0; });
  if (getirCol < 0 || benimposCol < 0) throw new Error('Barkod sütunu bulunamadı');
  const benimposSet = {};
  for (var i = 1; i < benimposValues.length; i++) {
    var b = String(benimposValues[i][benimposCol] || '').trim();
    if (b) benimposSet[b] = true;
  }
  var output = [['Getir satır', 'Getir barkodu', "BenimPOS'ta var mı?", 'Durum']];
  var found = 0, missing = 0, total = 0;
  for (var j = 1; j < getirValues.length; j++) {
    var barcode = String(getirValues[j][getirCol] || '').trim();
    if (!barcode) continue;
    total++;
    var exists = !!benimposSet[barcode];
    if (exists) found++; else missing++;
    output.push([j + 1, barcode, exists ? 'Evet' : 'Hayır', exists ? 'Var' : 'Yok']);
  }
  output.push(['']);
  output.push(['Özet', '', '', '']);
  output.push(['Toplam Getir ürün', total, '', '']);
  output.push(["BenimPOS'ta var", found, '', '']);
  output.push(["BenimPOS'ta yok", missing, '', '']);
  output.push(['BenimPOS benzersiz barkod', Object.keys(benimposSet).length, '', '']);
  compare.getRange(1, 1, output.length, 4).setValues(output);
  compare.getRange('B:B').setNumberFormat('@');
  compare.getRange(1, 1, 1, 4).setFontWeight('bold');
  return { totalGetir: total, found: found, missing: missing };
}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function buildMinimalLocalState() {
  const src = JSON.parse(fs.readFileSync(path.join(CHROME_USER_DATA_DIR, 'Local State'), 'utf8'));
  const info = src?.profile?.info_cache?.[CHROME_PROFILE];
  if (!info) throw new Error(`${CHROME_PROFILE} profili bulunamadı`);
  return { profile: { info_cache: { [CHROME_PROFILE]: info }, last_used: CHROME_PROFILE } };
}

async function syncProfile() {
  const src = path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE);
  const dst = path.join(PROFILE, CHROME_PROFILE);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(PROFILE, { recursive: true });
    execSync(`rsync -a "${src}/" "${dst}/"`, { stdio: 'inherit' });
    fs.writeFileSync(path.join(PROFILE, 'Local State'), `${JSON.stringify(buildMinimalLocalState())}\n`);
  }
}

async function cdpEvaluate(tab, expression) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP timeout')), 180000);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text || 'evaluate exception'));
      } else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', reject);
  });
}

async function findTab(match) {
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return tabs.find(match) || tabs[0];
}

async function launchChrome(url) {
  try {
    execSync(`pkill -f "remote-debugging-port=${CDP_PORT}"`, { stdio: 'ignore' });
  } catch {
    /* yok */
  }
  await sleep(1000);
  spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    url
  ], { stdio: 'ignore', detached: true }).unref();

  for (let i = 0; i < 25; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      return;
    } catch {
      if (i === 24) throw new Error('Chrome CDP başlatılamadı');
    }
  }
}

const runInEditorJs = `(async function(){
  const code = ${JSON.stringify(APPS_SCRIPT)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').trim().toLowerCase()
    .replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ü/g, 'u').replace(/ç/g, 'c').replace(/ğ/g, 'g');
  const clickText = (text) => {
    const el = Array.from(document.querySelectorAll('*')).find((node) => String(node.textContent || '').trim() === text);
    if (!el) return false;
    (el.closest('[role="button"], button, [role="option"]') || el).click();
    return true;
  };
  const clickRe = (re) => {
    const el = Array.from(document.querySelectorAll('button, [role="button"], [role="option"], span, div'))
      .find((node) => re.test(norm(node.textContent || '')));
    if (!el) return false;
    (el.closest('[role="button"], button, [role="option"]') || el).click();
    return true;
  };

  await sleep(8000);

  if (location.href.includes('/create?parent=')) {
    if (!clickText('Komut dosyası oluştur')) return { ok: false, reason: 'create_button_missing' };
    await sleep(10000);
  }

  const textarea = document.querySelector('.monaco-editor textarea.inputarea');
  if (!textarea) return { ok: false, reason: 'editor_missing', href: location.href };

  textarea.focus();
  await sleep(200);
  textarea.select();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, code);
  await sleep(1500);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, bubbles: true }));
  await sleep(2000);

  clickText('İşlev yok');
  await sleep(500);
  if (!clickText('compareGetirBenimposBarcodes')) clickRe(/comparegetirbenimposbarcodes/);
  await sleep(500);

  const runBtn = document.querySelector('[aria-label="Seçili işlevi çalıştır"], [aria-label="Run"], [aria-label="Çalıştır"]')
    || Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => /calistir|run/i.test(norm(el.textContent || '')));
  if (!runBtn) return { ok: false, reason: 'run_button_missing' };
  runBtn.click();

  for (let i = 0; i < 10; i += 1) {
    await sleep(3000);
    clickRe(/devam|continue|izinleri incele|review permissions|grant access/);
    clickRe(/izin ver|allow|authorize|kabul|onayla/);
    clickText('Gelişmiş');
    clickText('Karşılaştırma (güvenli değil)');
    clickText('Allow');
  }

  await sleep(8000);
  const log = document.body.innerText || '';
  const done = /Yürütme tamamlandı|Execution completed|totalGetir|found|missing|BenimPOS/i.test(log);
  const failed = /Syntax error|Söz dizimi hatası|ReferenceError|TypeError|Exception/i.test(log);
  return {
    ok: done && !failed,
    href: location.href,
    logTail: log.slice(-1500)
  };
})()`;

async function verifyCompareTab(tab) {
  return cdpEvaluate(tab, `(async function(){
    const url = 'https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet='
      + encodeURIComponent('Karşılaştır');
    const res = await fetch(url, { credentials: 'include' });
    const text = await res.text();
    const lines = text.split('\\n').filter(Boolean);
    return {
      ok: lines.length > 2 && /Getir sat/i.test(lines[0] || ''),
      lineCount: lines.length,
      preview: lines.slice(0, 5),
      summary: lines.slice(-6)
    };
  })()`);
}

async function main() {
  await syncProfile();
  console.log(`Cevizlibağ profili (${CHROME_PROFILE}) ile karşılaştırma çalıştırılıyor…`);

  await launchChrome(SCRIPT_EDIT_URL);
  await sleep(8000);

  let tab = await findTab((t) => t.url?.includes('script.google.com'));
  const runResult = await cdpEvaluate(tab, runInEditorJs);
  if (!runResult?.ok) {
    console.error('Apps Script çalıştırılamadı:', JSON.stringify(runResult, null, 2));
    process.exit(2);
  }

  await launchChrome(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=33433147`);
  await sleep(8000);

  tab = await findTab((t) => t.url?.includes('docs.google.com/spreadsheets'));
  const verify = await verifyCompareTab(tab);
  if (!verify?.ok) {
    console.error('Karşılaştır sekmesi doğrulanamadı:', JSON.stringify(verify, null, 2));
    process.exit(3);
  }

  console.log('✓ Karşılaştır sekmesi güncellendi.');
  console.log('Önizleme:', verify.preview.join(' | '));
  console.log('Özet:', verify.summary.join(' | '));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
