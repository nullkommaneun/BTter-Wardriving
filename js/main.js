// main.js — v1.5.6c (Analyzer-only, ohne Karte)
// - Keine Abhängigkeit von DB.getFiltered()
// - Stabile Event-Handler
// - Sichtbarer Preflight-Status (#preflightStatus oder #jsProbe)

import * as DB from './storage.js';
import * as BLE from './ble.js';
import * as F from './filters.js';
import * as CLU from './cluster.js';
import * as PROF from './profiler.js';
import * as SESSION from './session.js';
import * as GEO from './geo.js';

// ---------------- DOM ----------------
const el = {
  status: document.getElementById('status'),
  preflightStatus: document.getElementById('preflightStatus') || document.getElementById('jsProbe'),
  btnPreflight: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnResync: document.getElementById('btnResync'),
  btnStop: document.getElementById('btnStop'),
  // Filter
  fName: document.getElementById('fName'),
  fRssiMin: document.getElementById('fRssiMin'),
  fRssiMax: document.getElementById('fRssiMax'),
  fFrom: document.getElementById('fFrom'),
  fTo: document.getElementById('fTo'),
  fApple: document.getElementById('fApple'),
  fFastPair: document.getElementById('fFastPair'),
  fIndustrie: document.getElementById('fIndustrie'),
  btnApplyFilters: document.getElementById('btnApplyFilters'),
  btnClearFilters: document.getElementById('btnClearFilters'),
  // Zähler
  unique: document.getElementById('cntUnique'),
  packets: document.getElementById('cntPackets'),
  rate: document.getElementById('cntRate'),
  heartbeat: document.getElementById('heartbeat'),
  // Tabelle
  tableBody: document.getElementById('tableBody'),
  moreHint: document.getElementById('tableMoreHint'),
  // Analyzer
  devList: document.getElementById('devList'),
  devSearch: document.getElementById('devSearch'),
  devCount: document.getElementById('devCount'),
  anaWrap: document.getElementById('analysis'),
  anaEmpty: document.getElementById('analysisEmpty'),
  anaIcon: document.getElementById('anaIcon'),
  anaName: document.getElementById('anaName'),
  anaCat: document.getElementById('anaCat'),
  anaVendor: document.getElementById('anaVendor'),
  anaPackets: document.getElementById('anaPackets'),
  anaFirst: document.getElementById('anaFirst'),
  anaLast: document.getElementById('anaLast'),
  anaRssiStats: document.getElementById('anaRssiStats'),
  anaDistStats: document.getElementById('anaDistStats'),
  anaRawKeys: document.getElementById('anaRawKeys'),
  anaRaw: document.getElementById('anaRaw'),
  anaSpark: document.getElementById('anaSpark'),
  btnExportJSONOne: document.getElementById('btnExportJSONOne'),
  btnExportCSVOne: document.getElementById('btnExportCSVOne'),
  btnFilterOnly: document.getElementById('btnFilterOnly'),
  errorBanner: document.getElementById('errorBanner'),
};

function showError(msg) {
  console.error(msg);
  if (el.errorBanner) { el.errorBanner.style.display = 'block'; el.errorBanner.textContent = 'Fehler: ' + msg; }
  if (el.status) el.status.textContent = 'Fehler: ' + msg;
}
window.addEventListener('error', e => showError(e.message || 'Uncaught error'));
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || 'Promise rejected'));

function onSafe(node, ev, fn, opts) { if (node && node.addEventListener) node.addEventListener(ev, fn, opts); }
function sanitize(s) { return (s || '').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function deviceKey(name, uuids) { const n = (name || '∅').trim().toLowerCase(); const u = (Array.isArray(uuids) && uuids[0]) ? uuids[0] : '∅'; return n + '|' + u; }
function keyOf(r) { return deviceKey(r.deviceName, r.serviceUUIDs); }

function estDistance(rssi, txPower, n) {
  if (!Number.isFinite(rssi)) return null;
  const ref = Number.isFinite(txPower) ? txPower : -59;
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n)) : 2.0;
  const d = Math.pow(10, (ref - rssi) / (10 * N));
  const clamped = Math.max(0.1, Math.min(50, d));
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : null;
}

// ---------------- State ----------------
const appState = {
  preflightOk: false, scanning: false, lastAdvTs: 0,
  pathLossN: 2.0, sessionId: null,
  filters: { name: '', rssiMin: -80, rssiMax: null, from: null, to: null, apple: false, fastpair: false, industrie: false },
  heartbeatTimer: null,
};
let selectedKey = null;
let devicesIndex = new Map();

// ---------------- Analyzer ----------------
function summarizeDevices(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    let it = map.get(k);
    if (!it) {
      it = { key: k, name: r.deviceName || '(ohne Name)', icon: r.icon || '📡', category: r.category || '', vendor: r.vendor || '',
        first: r.timestamp, last: r.timestamp, count: 0, rssiVals: [], distVals: [], uuids: new Set(),
        lastRaw: { manufacturerData: r.manufacturerData || {}, serviceData: r.serviceData || {} }, samples: [] };
      map.set(k, it);
    }
    it.count++; it.last = r.timestamp; if (it.first > r.timestamp) it.first = r.timestamp;
    if (Number.isFinite(r.rssi)) it.rssiVals.push(r.rssi);
    if (Number.isFinite(r.distanceM)) it.distVals.push(r.distanceM);
    (r.serviceUUIDs || []).forEach(u => it.uuids.add(u));
    it.lastRaw = { manufacturerData: r.manufacturerData || {}, serviceData: r.serviceData || {} };
    it.samples.push({ ts: r.timestamp, rssi: r.rssi, dist: r.distanceM });
  }
  return map;
}

function renderDevList() {
  if (!el.devList) return;
  const q = (el.devSearch?.value || '').toLowerCase();
  const items = Array.from(devicesIndex.values()).filter(it => {
    if (!q) return true;
    const uu = Array.from(it.uuids).join(';').toLowerCase();
    return (it.name || '').toLowerCase().includes(q) || uu.includes(q);
  }).sort((a, b) => b.count - a.count);
  el.devList.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="name"><span>${it.icon}</span><span>${it.name}</span></div><div class="meta"><span class="count">${it.count}</span> • ${(it.category || '')}</div>`;
    li.addEventListener('click', () => selectDevice(it.key));
    el.devList.appendChild(li);
  }
  if (el.devCount) el.devCount.textContent = `${items.length} Geräte`;
}

function selectDevice(key) {
  selectedKey = key;
  const it = devicesIndex.get(key); if (!it) return;
  if (el.anaEmpty) el.anaEmpty.classList.add('hidden');
  if (el.anaWrap) el.anaWrap.classList.remove('hidden');
  if (el.anaIcon) el.anaIcon.textContent = it.icon || '📡';
  if (el.anaName) el.anaName.textContent = it.name || '(ohne Name)';
  if (el.anaCat) el.anaCat.textContent = it.category || '–';
  if (el.anaVendor) el.anaVendor.textContent = it.vendor || '–';
  if (el.anaPackets) el.anaPackets.textContent = String(it.count);
  if (el.anaFirst) el.anaFirst.textContent = new Date(it.first).toLocaleString();
  if (el.anaLast) el.anaLast.textContent = new Date(it.last).toLocaleString();
  const rssiAvg = mean(it.rssiVals), rssiMed = median(it.rssiVals);
  if (el.anaRssiStats) el.anaRssiStats.textContent = (rssiAvg !== null ? Math.round(rssiAvg) : '–') + ' / ' + (rssiMed !== null ? Math.round(rssiMed) : '–') + ' dBm';
  const distAvg = mean(it.distVals), distMed = median(it.distVals);
  if (el.anaDistStats) el.anaDistStats.textContent = (distAvg !== null ? distAvg.toFixed(1) : '–') + ' / ' + (distMed !== null ? distMed.toFixed(1) : '–') + ' m';
  if (el.anaRawKeys) el.anaRawKeys.textContent = `Hersteller: ${Object.keys(it.lastRaw.manufacturerData || {}).join(', ') || '–'} • Services: ${Object.keys(it.lastRaw.serviceData || {}).join(', ') || '–'}`;
  if (el.anaRaw) el.anaRaw.textContent = JSON.stringify(it.lastRaw, null, 2);
}

// ---------------- Datenpfad ----------------
async function getFilteredRows() {
  const all = await DB.getAllRecords();
  if (F && typeof F.applyFilters === 'function') return F.applyFilters(all, appState.filters);
  return all;
}

async function refreshUI() {
  const rows = await getFilteredRows();
  const clustered = (CLU && typeof CLU.clusterByTime === 'function') ? CLU.clusterByTime(rows, 5, appState.pathLossN) : rows;
  devicesIndex = summarizeDevices(clustered);
  renderDevList();
  const all = await DB.getAllRecords();
  const uniq = new Set(all.map(r => deviceKey(r.deviceName, r.serviceUUIDs)));
  if (el.unique) el.unique.textContent = String(uniq.size);
  if (el.packets) el.packets.textContent = String(all.length);
}

// ---------------- Preflight / Heartbeat ----------------
async function preflight() {
  const okBLE = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const okGeo = !!navigator.geolocation;
  const okWake = !!(navigator.wakeLock && navigator.wakeLock.request);
  const bits = [`requestLEScan:${okBLE ? 'OK' : 'NEIN'}`, `Geolocation:${okGeo ? 'OK' : 'NEIN'}`, `WakeLock:${okWake ? 'OK' : 'NEIN'}`];
  if (el.preflightStatus) el.preflightStatus.textContent = 'Preflight: ' + bits.join(' | ');
  if (el.status) el.status.textContent = 'Preflight: ' + bits.join(' | ');
  appState.preflightOk = okBLE;
  return okBLE;
}

// ---------------- Ingest ----------------
async function handleRecord(record) {
  const base = { ...record };
  base.distanceM = estDistance(base.rssi, base.txPower, appState.pathLossN);
  const prof = PROF.classify ? PROF.classify(base) : {};
  base.category = base.category || prof.category || '';
  base.vendor   = base.vendor   || prof.vendor   || '';
  base.icon     = base.icon     || prof.icon     || '';
  if (!base.timestamp) base.timestamp = new Date().toISOString();
  if (!Array.isArray(base.serviceUUIDs)) base.serviceUUIDs = [];
  if (!Number.isInteger(base.rssi)) base.rssi = Math.round(Number(base.rssi) || 0);
  await DB.putRecord(base);
  appState.lastAdvTs = Date.now();
}
BLE.onAdvertisement(async adv => {
  try { await handleRecord(adv); await refreshUI(); }
  catch (e) { showError('Ingest-Fehler: ' + e.message); }
});

// ---------------- UI Events ----------------
onSafe(el.btnPreflight, 'click', async () => {
  try { const ok = await preflight(); if (el.status) el.status.textContent = ok ? 'Preflight OK' : 'Preflight: fehlend'; }
  catch (e) { showError('Preflight fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnStart, 'click', async () => {
  try {
    if (!appState.preflightOk) { const ok = await preflight(); if (!ok) throw new Error('Browser unterstützt requestLEScan nicht'); }
    await GEO.start?.({ mode: 'drive' });
    await SESSION.ensure?.();
    appState.sessionId = SESSION.current ? SESSION.current() : null;
    await BLE.startScan();
    appState.scanning = true;
    if (el.status) el.status.textContent = 'Scan läuft…';
  } catch (e) { showError('Start fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnResync, 'click', async () => {
  try { await BLE.stopScan(); await new Promise(r => setTimeout(r, 200)); await BLE.startScan(); if (el.status) el.status.textContent = 'Resync durchgeführt'; }
  catch (e) { showError('Resync fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnStop, 'click', async () => {
  try { await BLE.stopScan(); appState.scanning = false; if (el.status) el.status.textContent = 'Scan gestoppt'; }
  catch (e) { showError('Stop fehlgeschlagen: ' + e.message); }
});

// ---------------- Boot ----------------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (el.status) el.status.textContent = 'Bereit';
    await (DB.init?.() || Promise.resolve());
    await preflight();
    await refreshUI();
  } catch (e) { showError('Init-Fehler: ' + e.message); }
});
