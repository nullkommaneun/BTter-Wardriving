// main.js — v1.5.6 (Analyzer-only, no map)
// Robust build: no optional-chaining on assignment, guarded event wiring, clean preflight & watchdog.
// Modules expected: storage.js (DB), ble.js (BLE), filters.js (F), cluster.js (CLU), export.js (EXP),
// profiler.js (PROF), session.js (SESSION), geo.js (GEO)

import * as DB from './storage.js';
import * as BLE from './ble.js';
import * as F from './filters.js';
import * as CLU from './cluster.js';
import * as EXP from './export.js';
import * as PROF from './profiler.js';
import * as SESSION from './session.js';
import * as GEO from './geo.js';

// ---------- Utilities ----------
const el = {
  // top status / controls
  status: document.getElementById('status'),
  btnPreflight: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnResync: document.getElementById('btnResync'),
  btnStop: document.getElementById('btnStop'),
  // filters
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
  // counters
  unique: document.getElementById('cntUnique'),
  packets: document.getElementById('cntPackets'),
  rate: document.getElementById('cntRate'),
  heartbeat: document.getElementById('heartbeat'),
  // table (optional in analyzer mode, still rendered if present)
  tableBody: document.getElementById('tableBody'),
  moreHint: document.getElementById('tableMoreHint'),
  // analyzer
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
  // error banner
  errorBanner: document.getElementById('errorBanner')
};

function showError(msg){
  console.error(msg);
  if (el.errorBanner){
    el.errorBanner.style.display = 'block';
    el.errorBanner.textContent = 'Fehler: ' + msg;
  }
  if (el.status){
    el.status.textContent = 'Fehler: ' + msg;
  }
}

window.addEventListener('error', (e)=> showError(e.message || 'Uncaught error'));
window.addEventListener('unhandledrejection', (e)=> showError(e.reason?.message || 'Promise rejected'));

function onSafe(node, ev, fn, opts){
  if (node && node.addEventListener) node.addEventListener(ev, fn, opts);
}

function deviceKey(name, uuids){
  const n = (name || '∅').trim().toLowerCase();
  const u = (Array.isArray(uuids) && uuids[0]) ? uuids[0] : '∅';
  return n + '|' + u;
}

function keyOf(rec){ return deviceKey(rec.deviceName, rec.serviceUUIDs); }

function mean(arr){ if(!arr.length) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }
function median(arr){ if(!arr.length) return null; const a=arr.slice().sort((x,y)=>x-y); const m=Math.floor(a.length/2); return (a.length%2? a[m] : (a[m-1]+a[m])/2); }

function sanitize(s){ return (s||'').replace(/[^a-z0-9-_]+/gi,'_').slice(0,60); }

// Path loss → distance
function estDistance(rssi, txPower, n){
  if(!Number.isFinite(rssi)) return null;
  const ref = Number.isFinite(txPower) ? txPower : -59;
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n)) : 2.0;
  const d = Math.pow(10, (ref - rssi) / (10 * N));
  const clamped = Math.max(0.1, Math.min(50, d));
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : null;
}

// EMA smoothing (optional)
function ema(prev, x, alpha=0.3){
  if(!Number.isFinite(x)) return prev ?? null;
  if(!Number.isFinite(prev)) return x;
  return prev + alpha * (x - prev);
}

// ---------- App State ----------
const appState = {
  preflightOk: false,
  scanning: false,
  lastAdvTs: 0,
  pathLossN: 2.0,
  sessionId: null,
  rssiEma: new Map(),
  filters: { name:'', rssiMin:-80, rssiMax:null, from:null, to:null, apple:false, fastpair:false, industrie:false },
  watchdogTimer: null,
  heartbeatTimer: null
};

let selectedKey = null;
let devicesIndex = new Map();

// ---------- Analyzer helpers ----------
function summarizeDevices(rows){
  const map = new Map();
  for(const r of rows){
    const k = keyOf(r);
    let entry = map.get(k);
    if(!entry){
      entry = {
        key:k, name: r.deviceName || '(ohne Name)',
        icon: r.icon || '📡',
        category: r.category || '',
        vendor: r.vendor || '',
        first: r.timestamp, last: r.timestamp,
        count: 0,
        rssiVals: [], distVals: [],
        uuids: new Set(),
        lastRaw: { manufacturerData: r.manufacturerData || {}, serviceData: r.serviceData || {} },
        samples: []
      };
      map.set(k, entry);
    }
    entry.count++;
    entry.last = r.timestamp;
    if(entry.first > r.timestamp) entry.first = r.timestamp;
    if(Number.isFinite(r.rssi)) entry.rssiVals.push(r.rssi);
    if(Number.isFinite(r.distanceM)) entry.distVals.push(r.distanceM);
    (r.serviceUUIDs||[]).forEach(u => entry.uuids.add(u));
    entry.lastRaw = { manufacturerData: r.manufacturerData || {}, serviceData: r.serviceData || {} };
    entry.samples.push({ ts: r.timestamp, rssi: r.rssi, dist: r.distanceM });
  }
  return map;
}

function drawSpark(samples){
  const c = el.anaSpark;
  if(!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if(!samples.length) return;
  const N = Math.min(200, samples.length);
  const arr = samples.slice(-N);
  const xs = arr.map(x=> new Date(x.ts).getTime());
  const ys = arr.map(x=> (Number.isFinite(x.rssi)? x.rssi : -100));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 8, w = c.width, h = c.height;
  const xmap = v => pad + (w-2*pad) * ( (v-minX) / Math.max(1, maxX-minX) );
  const ymap = v => pad + (h-2*pad) * ( ( (v - maxY) / Math.max(1, maxY-minY) ) );
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  arr.forEach((p,i)=>{
    const x = xmap(new Date(p.ts).getTime());
    const y = ymap(Number.isFinite(p.rssi)? p.rssi : -100);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();
}

function renderDevList(){
  if(!el.devList) return;
  const filterText = (el.devSearch?.value || '').toLowerCase();
  const items = Array.from(devicesIndex.values()).filter(it=>{
    if(!filterText) return true;
    const uu = Array.from(it.uuids).join(';').toLowerCase();
    return (it.name||'').toLowerCase().includes(filterText) || uu.includes(filterText);
  }).sort((a,b)=> b.count - a.count);
  el.devList.innerHTML = '';
  for(const it of items){
    const li = document.createElement('li');
    li.innerHTML = `<div class="name"><span>${it.icon}</span><span>${it.name}</span></div><div class="meta"><span class="count">${it.count}</span> • ${(it.category||'')}</div>`;
    li.addEventListener('click', ()=> selectDevice(it.key));
    el.devList.appendChild(li);
  }
  if(el.devCount) el.devCount.textContent = `${items.length} Geräte`;
}

function selectDevice(key){
  selectedKey = key;
  const it = devicesIndex.get(key);
  if(!it) return;
  if(el.anaEmpty) el.anaEmpty.classList.add('hidden');
  if(el.anaWrap) el.anaWrap.classList.remove('hidden');
  if(el.anaIcon) el.anaIcon.textContent = it.icon || '📡';
  if(el.anaName) el.anaName.textContent = it.name || '(ohne Name)';
  if(el.anaCat) el.anaCat.textContent = it.category || '–';
  if(el.anaVendor) el.anaVendor.textContent = it.vendor || '–';
  if(el.anaPackets) el.anaPackets.textContent = String(it.count);
  if(el.anaFirst) el.anaFirst.textContent = new Date(it.first).toLocaleString();
  if(el.anaLast) el.anaLast.textContent = new Date(it.last).toLocaleString();
  const rssiAvg = mean(it.rssiVals), rssiMed = median(it.rssiVals);
  if(el.anaRssiStats) el.anaRssiStats.textContent = (rssiAvg!==null? Math.round(rssiAvg):'–') + ' / ' + (rssiMed!==null? Math.round(rssiMed):'–') + ' dBm';
  const distAvg = mean(it.distVals), distMed = median(it.distVals);
  if(el.anaDistStats) el.anaDistStats.textContent = (distAvg!==null? distAvg.toFixed(1):'–') + ' / ' + (distMed!==null? distMed.toFixed(1):'–') + ' m';
  const mKeys = Object.keys(it.lastRaw.manufacturerData||{}).join(', ') || '–';
  const sKeys = Object.keys(it.lastRaw.serviceData||{}).join(', ') || '–';
  if(el.anaRawKeys) el.anaRawKeys.textContent = `Hersteller: ${mKeys} • Services: ${sKeys}`;
  if(el.anaRaw) el.anaRaw.textContent = JSON.stringify(it.lastRaw, null, 2);
  drawSpark(it.samples);
}

// ---------- Rendering ----------
async function renderTable(rows){
  if(!el.tableBody) return; // analyzer build may not show table
  const maxRows = 5;
  el.tableBody.innerHTML = '';
  const visible = rows.slice(0, maxRows);
  for(const r of visible){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(r.timestamp).toLocaleString()}</td>
      <td>${(r.icon||'')} ${(r.deviceName||'')}</td>
      <td>${(r.serviceUUIDs||[]).join(';')}</td>
      <td>${r.rssi ?? ''}</td>
      <td>${r.latitude ?? ''}</td>
      <td>${r.longitude ?? ''}</td>
      <td>${r.distanceM ?? ''}</td>
    `;
    el.tableBody.appendChild(tr);
  }
  if(el.moreHint){
    const hidden = Math.max(0, rows.length - visible.length);
    el.moreHint.textContent = hidden > 0 ? `… ${hidden} weitere verborgen` : '';
  }
}

async function refreshUI(){
  const rows = await DB.getFiltered();
  const clustered = CLU.clusterByTime(rows, 5, appState.pathLossN);
  devicesIndex = summarizeDevices(clustered);
  renderDevList();
  renderTable(clustered);

  // counters
  const all = await DB.getAllRecords();
  const uniq = new Set(all.map(r => deviceKey(r.deviceName, r.serviceUUIDs)));
  if(el.unique) el.unique.textContent = String(uniq.size);
  if(el.packets) el.packets.textContent = String(all.length);
}

// ---------- Preflight / Watchdog / Heartbeat ----------
async function preflight(){
  // quick feature probe text, if present
  const probe = [];
  function add(name, ok){ probe.push(`${name}:${ok?'OK':'NEIN'}`); }
  add('requestLEScan', !!(navigator.bluetooth && navigator.bluetooth.requestLEScan));
  add('Geolocation', !!navigator.geolocation);
  add('WakeLock', !!(navigator.wakeLock && navigator.wakeLock.request));
  if(el.status) el.status.textContent = 'Preflight: ' + probe.join(' | ');
  appState.preflightOk = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  return appState.preflightOk;
}

function getRate(){
  // simple rate estimator based on DB timestamps (last 60s)
  // fallback: packets/min since last minute
  return DB.countLastSeconds ? DB.countLastSeconds(60) : 0;
}

function startHeartbeat(){
  stopHeartbeat();
  appState.heartbeatTimer = setInterval(()=>{
    const silentMs = Date.now() - appState.lastAdvTs;
    if(el.heartbeat){
      el.heartbeat.textContent = `letztes Paket vor ${Math.floor(silentMs/1000)} s • Rate/min: ${String(getRate())}`;
    }
    // Tier 1: quick restart (12s drive / 20s normal)
    const thr = 12000; // keep simple
    if(appState.preflightOk && silentMs > thr){
      BLE.stopScan().catch(()=>{});
      setTimeout(()=> BLE.startScan().catch(()=>{}), 200);
      appState.lastAdvTs = Date.now();
    }
    // Tier 2: hard resync after 60s inactivity
    if(appState.preflightOk && silentMs > 60000){
      (async ()=>{
        try{ await DB.flushNow?.(); }catch(_){}
        try{ await BLE.stopScan(); }catch(_){}
        await new Promise(r=>setTimeout(r,300));
        try{ await BLE.startScan(); if(el.status) el.status.textContent = 'Auto-Resync nach Inaktivität…'; }catch(_){}
        appState.lastAdvTs = Date.now();
      })();
    }
  }, 1000);
}
function stopHeartbeat(){ if(appState.heartbeatTimer){ clearInterval(appState.heartbeatTimer); appState.heartbeatTimer = null; } }

// ---------- Ingest ----------
async function handleRecord(record){
  // shape/validate & enrich
  const base = { ...record };
  base.distanceM = estDistance(base.rssi, base.txPower, appState.pathLossN);
  const prof = PROF.classify ? PROF.classify(base) : {};
  base.category = base.category || prof.category || '';
  base.vendor   = base.vendor   || prof.vendor   || '';
  base.icon     = base.icon     || prof.icon     || '';

  // validate mandatory fields fallback
  if(!base.timestamp) base.timestamp = new Date().toISOString();
  if(!Array.isArray(base.serviceUUIDs)) base.serviceUUIDs = [];
  if(!Number.isInteger(base.rssi)) base.rssi = Math.round(Number(base.rssi)||0);

  await DB.putRecord(base);
  appState.lastAdvTs = Date.now();
}

BLE.onAdvertisement(async (adv) => {
  try{
    await handleRecord(adv);
    await refreshUI();
  }catch(e){ showError('Ingest-Fehler: ' + e.message); }
});

// ---------- UI Events ----------
onSafe(el.btnPreflight, 'click', async ()=>{
  try{
    const ok = await preflight();
    if(el.status) el.status.textContent = ok ? 'Preflight OK' : 'Preflight: fehlend';
  }catch(e){ showError('Preflight fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnStart, 'click', async ()=>{
  try{
    if(!appState.preflightOk){ const ok = await preflight(); if(!ok) throw new Error('Browser unterstützt requestLEScan nicht'); }
    await GEO.start?.({ mode:'drive' });
    await SESSION.ensure();
    appState.sessionId = SESSION.current();
    await BLE.startScan();
    appState.scanning = true;
    if(el.status) el.status.textContent = 'Scan läuft…';
    startHeartbeat();
  }catch(e){ showError('Start fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnResync, 'click', async ()=>{
  try{
    await BLE.stopScan();
    await new Promise(r=>setTimeout(r,200));
    await BLE.startScan();
    if(el.status) el.status.textContent = 'Resync durchgeführt';
  }catch(e){ showError('Resync fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnStop, 'click', async ()=>{
  try{
    await BLE.stopScan();
    appState.scanning = false;
    stopHeartbeat();
    if(el.status) el.status.textContent = 'Scan gestoppt';
  }catch(e){ showError('Stop fehlgeschlagen: ' + e.message); }
});

onSafe(el.btnApplyFilters, 'click', ()=>{
  appState.filters = {
    name: el.fName?.value || '',
    rssiMin: Number(el.fRssiMin?.value) || -120,
    rssiMax: el.fRssiMax?.value ? Number(el.fRssiMax.value) : null,
    from: el.fFrom?.value || null,
    to: el.fTo?.value || null,
    apple: !!(el.fApple && el.fApple.checked),
    fastpair: !!(el.fFastPair && el.fFastPair.checked),
    industrie: !!(el.fIndustrie && el.fIndustrie.checked)
  };
  refreshUI();
});

onSafe(el.btnClearFilters, 'click', ()=>{
  if(el.fName) el.fName.value = '';
  if(el.fApple) el.fApple.checked = false;
  if(el.fFastPair) el.fFastPair.checked = false;
  if(el.fIndustrie) el.fIndustrie.checked = false;
  appState.filters = { name:'', rssiMin:-80, rssiMax:null, from:null, to:null, apple:false, fastpair:false, industrie:false };
  refreshUI();
});

onSafe(el.devSearch, 'input', ()=> renderDevList());

// Analyzer buttons (per device)
onSafe(el.btnExportJSONOne, 'click', async ()=>{
  const rows = await DB.getAllRecords();
  const filtered = rows.filter(r => keyOf(r) === selectedKey);
  const ts = new Date().toISOString().replace(/:/g,'-');
  const it = devicesIndex.get(selectedKey);
  const name = sanitize(it?.name || 'device');
  const blob = new Blob([JSON.stringify(filtered, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `device_${name}_${ts}.json`; a.click();
});

onSafe(el.btnExportCSVOne, 'click', async ()=>{
  const rows = await DB.getAllRecords();
  const filtered = rows.filter(r => keyOf(r) === selectedKey);
  const header = ['timestamp','deviceName','serviceUUIDs','rssi','txPower','distanceM','latitude','longitude','sessionId','category','vendor','icon'];
  const lines = [header.join(',')];
  for(const r of filtered){
    const uu = (r.serviceUUIDs||[]).join(';');
    const vals = [r.timestamp, r.deviceName||'', uu, r.rssi??'', r.txPower??'', r.distanceM??'', r.latitude??'', r.longitude??'', r.sessionId||'', r.category||'', r.vendor||'', r.icon||''];
    lines.push(vals.map(v => String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(','));
  }
  const ts = new Date().toISOString().replace(/:/g,'-');
  const it = devicesIndex.get(selectedKey);
  const name = sanitize(it?.name || 'device');
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `device_${name}_${ts}.csv`; a.click();
});

onSafe(el.btnFilterOnly, 'click', ()=>{
  const it = devicesIndex.get(selectedKey);
  const name = it?.name || '';
  if(el.fName) el.fName.value = name;
  appState.filters.name = name;
  refreshUI();
});

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    if(el.status) el.status.textContent = 'Bereit';
    await DB.init?.();
    await preflight();
    await refreshUI();
  }catch(e){ showError('Init-Fehler: ' + e.message); }
});