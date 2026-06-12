#!/usr/bin/env node
/**
 * Getir ↔ BenimPOS barkod karşılaştırması (Google Sheets).
 * Kimlik doğrulaması için /tmp altındaki Chrome profil kopyasını kullanır.
 *
 *   node scripts/google-sheets-getir-benimpos-compare.js
 *   CHROME_RESYNC=1 node scripts/google-sheets-getir-benimpos-compare.js
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
const CHROME_PROFILE = process.env.CHROME_PROFILE || 'Profile 2'; // Cevizlibağ
const PROFILE = path.resolve(process.env.CHROME_AUTOMATION_DIR
  || path.join(os.tmpdir(), 'petfix-sheets-automation'));
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const FORCE_RESYNC = process.env.CHROME_RESYNC === '1';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID
  || '1P2HPmJrTEKLjmDcqYAQLmn1YnFijqEKmWEu21fxRreA';
const SHEET_GETIR = process.env.SHEET_GETIR || 'Getir';
const SHEET_BENIMPOS = process.env.SHEET_BENIMPOS || 'BenimPOS';
const SHEET_COMPARE = process.env.SHEET_COMPARE || 'Karşılaştır';

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
  if (!info) throw new Error(`Local State içinde ${CHROME_PROFILE} kaydı yok.`);
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
    throw new Error(`Chrome profili bulunamadı: ${srcProfile}`);
  }

  const chromeRunning = await isGoogleChromeRunningAsync();
  const dstExists = fs.existsSync(dstProfile);

  if (chromeRunning && !FORCE_RESYNC) {
    if (!dstExists) {
      console.log('Chrome açık — otomasyon kopyası yok, salt-okuma rsync deneniyor…');
    } else {
      console.log('Chrome açık — mevcut otomasyon kopyası kullanılacak.');
      return;
    }
  }

  if (chromeRunning && FORCE_RESYNC) {
    throw new Error('CHROME_RESYNC=1 için önce normal Chrome\'u kapatın.');
  }

  fs.mkdirSync(PROFILE, { recursive: true });
  console.log(`Profil kopyalanıyor: ${CHROME_PROFILE} → ${PROFILE}`);
  execSync(`rsync -a --delete "${srcProfile}/" "${dstProfile}/"`, { stdio: 'inherit' });
  fs.writeFileSync(
    path.join(PROFILE, 'Local State'),
    `${JSON.stringify(buildMinimalLocalState())}\n`
  );
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

async function findSheetTab() {
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return tabs.find((t) => t.url?.includes(SPREADSHEET_ID)) || tabs[0];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\r') {
      /* skip */
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function normalizeBarcode(value) {
  if (value == null) return '';
  return String(value).trim();
}

function findBarcodeColumnIndex(headerRow, preferredNames = []) {
  const normalized = headerRow.map((h) => String(h || '').trim().toLowerCase());
  for (const name of preferredNames) {
    const idx = normalized.findIndex((h) => h === name.toLowerCase() || h.includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  const generic = normalized.findIndex((h) =>
    h.includes('barkod') || h.includes('barcode') || h === 'ean' || h === 'gtin'
  );
  return generic;
}

function extractBarcodes(rows, preferredNames) {
  if (!rows.length) return { barcodes: [], header: [], barcodeCol: -1 };

  const header = rows[0].map((c) => String(c || '').trim());
  let barcodeCol = findBarcodeColumnIndex(header, preferredNames);

  if (barcodeCol < 0) {
    barcodeCol = header.findIndex((_, idx) =>
      rows.slice(1, 20).some((r) => normalizeBarcode(r[idx]))
    );
  }

  const barcodes = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row?.length) continue;
    const barcode = normalizeBarcode(row[barcodeCol]);
    if (!barcode) continue;
    barcodes.push({
      rowNumber: i + 1,
      barcode,
      row
    });
  }

  return { barcodes, header, barcodeCol };
}

function buildCompareRows(getirItems, benimposBarcodeSet) {
  const output = [[
    'Getir satır',
    'Getir barkodu',
    'BenimPOS\'ta var mı?',
    'Durum'
  ]];

  let found = 0;
  let missing = 0;

  for (const item of getirItems) {
    const exists = benimposBarcodeSet.has(item.barcode);
    if (exists) found += 1;
    else missing += 1;
    output.push([
      item.rowNumber,
      item.barcode,
      exists ? 'Evet' : 'Hayır',
      exists ? 'Var' : 'Yok'
    ]);
  }

  output.push([]);
  output.push(['Özet', '', '', '']);
  output.push(['Toplam Getir ürün', getirItems.length, '', '']);
  output.push(['BenimPOS\'ta var', found, '', '']);
  output.push(['BenimPOS\'ta yok', missing, '', '']);
  output.push(['BenimPOS benzersiz barkod', benimposBarcodeSet.size, '', '']);

  return { output, found, missing };
}

const readAndWriteJs = `(async function(){
  const SPREADSHEET_ID = ${JSON.stringify(SPREADSHEET_ID)};
  const SHEET_GETIR = ${JSON.stringify(SHEET_GETIR)};
  const SHEET_BENIMPOS = ${JSON.stringify(SHEET_BENIMPOS)};
  const SHEET_COMPARE = ${JSON.stringify(SHEET_COMPARE)};
  const compareRows = ${'__COMPARE_ROWS__'};

  if (/accounts\\.google\\.com/i.test(location.hostname)) {
    return { ok: false, reason: 'login_required', url: location.href };
  }

  async function fetchSheetCsv(sheetName) {
    const url = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID
      + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName);
    const res = await fetch(url, { credentials: 'include' });
    const text = await res.text();
    if (!res.ok || text.startsWith('<!DOCTYPE')) {
      return { ok: false, status: res.status, preview: text.slice(0, 120), sheetName };
    }
    return { ok: true, text, sheetName };
  }

  async function ensureCompareSheet() {
    const openUrl = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit';
    if (!location.href.includes(SPREADSHEET_ID)) {
      location.href = openUrl;
      await new Promise((r) => setTimeout(r, 8000));
    }
    return { url: location.href };
  }

  await ensureCompareSheet();

  const getirCsv = await fetchSheetCsv(SHEET_GETIR);
  const benimposCsv = await fetchSheetCsv(SHEET_BENIMPOS);
  if (!getirCsv.ok || !benimposCsv.ok) {
    return {
      ok: false,
      reason: 'csv_export_failed',
      getirCsv,
      benimposCsv,
      url: location.href
    };
  }

  return {
    ok: true,
    getirCsv: getirCsv.text,
    benimposCsv: benimposCsv.text,
    compareRows,
    url: location.href
  };
})()`;

const writeCompareJs = `(async function(){
  const SPREADSHEET_ID = ${JSON.stringify(SPREADSHEET_ID)};
  const SHEET_COMPARE = ${JSON.stringify(SHEET_COMPARE)};
  const compareRows = ${'__COMPARE_ROWS__'};

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  if (/accounts\\.google\\.com/i.test(location.hostname)) {
    return { ok: false, reason: 'login_required', url: location.href };
  }

  const targetUrl = 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit';
  if (!location.href.includes(SPREADSHEET_ID)) {
    location.href = targetUrl;
    await sleep(8000);
  }

  const norm = (s) => (s || '').trim().toLowerCase()
    .replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ü/g, 'u').replace(/ç/g, 'c').replace(/ğ/g, 'g');

  const clickTab = (name) => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .docs-sheet-tab-name, .sheet-tab'));
    const tab = tabs.find((el) => norm(el.textContent) === norm(name));
    if (tab) {
      tab.click();
      return true;
    }
    return false;
  };

  if (!clickTab(SHEET_COMPARE)) {
    const addBtn = Array.from(document.querySelectorAll('button, [role="button"]'))
      .find((el) => /yeni sayfa|add sheet|sayfa ekle/i.test(el.getAttribute('aria-label') || el.textContent || ''));
    if (addBtn) {
      addBtn.click();
      await sleep(1500);
    }
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .docs-sheet-tab-name, .sheet-tab'));
    const last = tabs[tabs.length - 1];
    if (last) {
      last.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(400);
      const input = document.activeElement;
      if (input && input.tagName === 'INPUT') {
        input.value = SHEET_COMPARE;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(800);
      }
    }
    clickTab(SHEET_COMPARE);
  }

  await sleep(2000);

  const tsv = compareRows.map((row) => row.map((cell) => {
    const text = String(cell ?? '');
    if (/[\\t\\n"]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }).join('\\t')).join('\\n');

  await navigator.clipboard.writeText(tsv);
  await sleep(300);

  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'a', code: 'KeyA', ctrlKey: true, metaKey: true, bubbles: true
  }));
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'v', code: 'KeyV', ctrlKey: true, metaKey: true, bubbles: true
  }));
  await sleep(1500);

  return {
    ok: true,
    rowCount: compareRows.length,
    url: location.href,
    tab: SHEET_COMPARE
  };
})()`;

async function main() {
  stopAutomationChromeOnly();
  await sleep(1500);
  await syncAutomationProfileCopy();

  const targetUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
  console.log(`Chrome CDP (${CHROME_PROFILE}) → port ${CDP_PORT}`);
  console.log(`Spreadsheet: ${SPREADSHEET_ID}`);

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--profile-directory=${CHROME_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    targetUrl
  ], { stdio: 'ignore', detached: true });
  chrome.unref();

  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    try {
      await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      if (i === 29) {
        console.error('CDP bağlantısı kurulamadı');
        process.exit(1);
      }
    }
  }

  console.log('Sayfa yükleniyor…');
  await sleep(8000);

  let tab = await findSheetTab();
  const readJs = readAndWriteJs.replace('__COMPARE_ROWS__', '[]');
  const readResult = await cdpEvaluate(tab, readJs);

  if (!readResult?.ok) {
    console.error('Veri okunamadı:', JSON.stringify(readResult, null, 2));
    if (readResult?.reason === 'login_required') {
      console.error('Google oturumu yok. Açılan Chrome penceresinde giriş yapıp tekrar deneyin.');
    }
    process.exit(2);
  }

  const getirRows = parseCsv(readResult.getirCsv);
  const benimposRows = parseCsv(readResult.benimposCsv);

  const getir = extractBarcodes(getirRows, [
    'barkod', 'barcode', 'ürün barkodu', 'urun barkodu', 'ean', 'gtin'
  ]);
  const benimpos = extractBarcodes(benimposRows, [
    'barkod', 'barcode', 'ürün barkodu', 'urun barkodu', 'ean', 'gtin'
  ]);

  if (getir.barcodeCol < 0) {
    console.error('Getir sekmesinde barkod sütunu bulunamadı. Başlıklar:', getir.header);
    process.exit(3);
  }
  if (benimpos.barcodeCol < 0) {
    console.error('BenimPOS sekmesinde barkod sütunu bulunamadı. Başlıklar:', benimpos.header);
    process.exit(3);
  }

  const benimposSet = new Set(benimpos.barcodes.map((b) => b.barcode));
  const { output, found, missing } = buildCompareRows(getir.barcodes, benimposSet);

  console.log(`Getir: ${getir.barcodes.length} barkod (sütun: ${getir.header[getir.barcodeCol] || getir.barcodeCol + 1})`);
  console.log(`BenimPOS: ${benimposSet.size} benzersiz barkod (sütun: ${benimpos.header[benimpos.barcodeCol] || benimpos.barcodeCol + 1})`);
  console.log(`Eşleşen: ${found} · Eksik: ${missing}`);

  tab = await findSheetTab();
  const writeJs = writeCompareJs.replace(
    '__COMPARE_ROWS__',
    JSON.stringify(output)
  );
  const writeResult = await cdpEvaluate(tab, writeJs);

  if (!writeResult?.ok) {
    console.error('Karşılaştır sekmesine yazılamadı:', JSON.stringify(writeResult, null, 2));
    process.exit(4);
  }

  console.log(`\n✓ ${writeResult.rowCount} satır "${SHEET_COMPARE}" sekmesine yazıldı.`);
  console.log(writeResult.url);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
