// js/main.js — Hybrid modular build (v1.6.4+)
import * as BLE from './ble.js';
import * as DB from './storage.js';

const ui = {
  probe: document.getElementById('jsProbe'),
  pf: document.getElementById('preflightStatus'),
  status: document.getElementById('status'),
  err: document.getElementById('errorBanner'),
  btnPre: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnResync: document.getElementById('btnResync'),
  btnAddWatch: document.getElementById('btnAddWatch'),
  cntU: document.getElementById('cntUnique'),
  cntP: document.getElementById('cntPackets'),
  heartbeat: document.getElementById('heartbeat'),
  devList: document.getElementById('devList'),
  watchGrid: document.getElementById('watchGrid')
};

ui.probe.textContent = 'JS-Modul geladen (Hybrid modular)';

// ---------- Utility / UI ----------
function showError(msg){
  console.error('[BLE]', msg);
  ui.err.style.display = 'block';
  ui.err.textContent = 'Fehler: ' + msg;
  ui.status.textContent = 'Fehler: ' + msg;
}
function setPF(msg){ ui.pf.textContent = msg; ui.status.textContent = msg; }
function setStatus(msg){ ui.status.textContent = msg; }

window.addEventListener('error', e => showError(e.message || 'Uncaught error'));
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || 'Promise rejected'));

let hbTimer = null;
let lastTs = 0;

const records = [];                 // alle Pakete (global + watches)
const uniq = new Set();             // unique deviceKey(name|uuid)
const watchState = new Map();       // id -> { name, count, lastTs, active }

function deviceKey(name, uuids){
  const n = (name || '∅').trim().toLowerCase();
  const u = (Array.isArray(uuids) && uuids[0]) ? uuids[0] : '∅';
  return n + '|' + u;
}

// ---------- Rendering ----------
function renderAggregates(){
  ui.devList.innerHTML = '';
  const counts = new Map();
  for (const r of records) {
    const k = deviceKey(r.deviceName, r.serviceUUIDs);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const items = Array.from(counts.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 50);

  for (const [k, c] of items) {
    const [namePart, uuidPart = '∅'] = String(k).split('|');
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="row1">
        <div class="name">${namePart || '(ohne Name)'}</div>
        <div class="count">${c}×</div>
      </div>
      <div class="uuid">${uuidPart}</div>
    `;
    // Optional: Klick-Action, um daraus direkt einen Watch zu starten
    li.title = 'Gerät beobachten (watchAdvertisements)';
    li.style.cursor = 'pointer';
    li.addEventListener('click', addWatch); // führt zur Geräteauswahl
    ui.devList.appendChild(li);
  }
}

function renderWatches(){
  ui.watchGrid.innerHTML = '';
  for (const [id, w] of watchState) {
    const el = document.createElement('div');
    el.className = 'watch';
    el.innerHTML = `
      <h3>${w.name || '(ohne Name)'} <span class="small">(${id})</span></h3>
      <div class="row"><span>Pakete</span><span>${w.count}</span></div>
      <div class="row"><span>Letzte Sichtung</span><span>${w.lastTs ? new Date(w.lastTs).toLocaleTimeString() : '–'}</span></div>
      <div class="small">Status: ${w.active ? 'aktiv' : 'gestoppt'}</div>
      <div style="margin-top:8px"><button data-id="${id}" class="btnStopWatch">Watch stoppen</button></div>
    `;
    ui.watchGrid.appendChild(el);
  }
  ui.watchGrid.querySelectorAll('.btnStopWatch').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      BLE.stopWatch(id);
      const w = watchState.get(id);
      if (w) { w.active = false; renderWatches(); }
    });
  });
}

// ---------- Preflight / Heartbeat ----------
async function preflight(){
  const okBLE  = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const okGeo  = !!navigator.geolocation;
  const okWake = !!(navigator.wakeLock && navigator.wakeLock.request);
  const msg = `Preflight: requestLEScan:${okBLE?'OK':'NEIN'} | Geolocation:${okGeo?'OK':'NEIN'} | WakeLock:${okWake?'OK':'NEIN'}`;
  setPF(msg);
  return okBLE;
}

function startHB(){
  stopHB();
  hbTimer = setInterval(()=>{
    const s = Math.floor((Date.now() - lastTs) / 1000);
    ui.heartbeat.textContent = `letztes Paket vor ${s}s • ${records.length} gesamt`;
  }, 1000);
}
function stopHB(){ if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

// ---------- Data ingest ----------
BLE.setAdvertisementHandler(async (rec)=>{
  records.push(rec);
  lastTs = Date.now();

  // Persistenz (best effort)
  try { await DB.putRecord(rec); } catch(_){ /* tolerieren */ }

  // Aggregation
  uniq.add(deviceKey(rec.deviceName, rec.serviceUUIDs));
  ui.cntU.textContent = String(uniq.size);
  ui.cntP.textContent = String(records.length);
  renderAggregates();

  // Watch-spezifische Zähler (beste Übereinstimmung über deviceId)
  if (rec.deviceId && watchState.has(rec.deviceId)) {
    const w = watchState.get(rec.deviceId);
    w.count++; w.lastTs = Date.now();
    renderWatches();
  } else {
    // Manche UAs liefern keine deviceId in Adv-Events → best-effort
    for (const [id, w] of watchState) {
      if (w.active) { w.count++; w.lastTs = Date.now(); }
    }
    renderWatches();
  }
});

// ---------- Control actions ----------
async function startGlobal(){
  const ok = await preflight();
  if (!ok) throw new Error('requestLEScan nicht verfügbar');

  await stopAll(false);
  await BLE.startGlobalScan();

  setStatus('Globaler Scan läuft…');
  startHB();

  // Hinweis, falls 5 s lang keine Pakete eintreffen
  const base = records.length;
  setTimeout(()=>{
    if (records.length === base) {
      setStatus('Keine globalen Pakete binnen 5s. Nutze Geräte-Watches als Workaround.');
    }
  }, 5000);
}

async function addWatch(){
  try{
    const info = await BLE.addWatch();
    if (!info) return;
    watchState.set(info.id, { name: info.name, count: 0, lastTs: 0, active: true });
    renderWatches();
  }catch(e){
    showError('Watch-Start fehlgeschlagen: ' + e.message);
  }
}

async function stopAll(fromUser = true){
  try { BLE.stopGlobalScan(); } catch(_){}
  for (const [id, w] of watchState) {
    try { BLE.stopWatch(id); } catch(_){}
    w.active = false;
  }
  renderWatches();
  stopHB();
  if (fromUser) setStatus('Alle Scans gestoppt');
}

// ---------- Event wiring ----------
document.getElementById('btnPreflight').addEventListener('click', preflight);
document.getElementById('btnStart').addEventListener('click', async()=>{
  try{ await startGlobal(); }catch(e){ showError('Start-Fehler: ' + e.message); }
});
document.getElementById('btnStop').addEventListener('click', ()=> stopAll(true));
document.getElementById('btnResync').addEventListener('click', async()=>{
  try{ await stopAll(false); await startGlobal(); }catch(e){ showError('Resync-Fehler: ' + e.message); }
});
document.getElementById('btnAddWatch').addEventListener('click', addWatch);

document.addEventListener('DOMContentLoaded', async ()=>{
  ui.probe.textContent = 'JS-Modul geladen (Hybrid modular)';
  try { await DB.init(); } catch(_){}
  await preflight();
}); 
