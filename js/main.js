import * as BLE from './ble.js';
import * as GEO from './geo.js';
import * as DB from './storage.js';
import * as MAP from './map.js';
import * as FIL from './filters.js';
import * as EXP from './export.js';
import * as CLU from './cluster.js';
import * as PRO from './profiler.js';
import * as SES from './session.js';

const appState = {
  driveMode: false,
  cluster: true,
  packetCount: 0,
  uniqueSet: new Set(),
  rateBuffer: [],
  lastTick: 0,
  renderQueue: [],
  preflightOk: false,
  filters: { name:'', rssiMin:-80, rssiMax:null, from:null, to:null }, // Default: nahe Signale
};

const el = {
  status: document.getElementById('status'),
  modeBadge: document.getElementById('modeBadge'),
  unique: document.getElementById('uniqueCount'),
  packets: document.getElementById('packetCount'),
  rate: document.getElementById('ratePerMin'),
  tblBody: document.getElementById('tblBody'),
  hiddenHint: document.getElementById('hiddenHint'),
  btnPreflight: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  toggleDrive: document.getElementById('toggleDrive'),
  toggleCluster: document.getElementById('toggleCluster'),
  fName: document.getElementById('fName'),
  fRssiMin: document.getElementById('fRssiMin'),
  fRssiMax: document.getElementById('fRssiMax'),
  fFrom: document.getElementById('fFrom'),
  fTo: document.getElementById('fTo'),
  btnApplyFilters: document.getElementById('btnApplyFilters'),
  btnClearFilters: document.getElementById('btnClearFilters'),
  btnExportJSON: document.getElementById('btnExportJSON'),
  btnExportCSV: document.getElementById('btnExportCSV'),
  btnExportCSVFiltered: document.getElementById('btnExportCSVFiltered'),
  btnExportCSVCluster: document.getElementById('btnExportCSVCluster'),
};

const nowIso = () => new Date().toISOString();
const clampRateWindowMs = 60_000;
function resetRate() { appState.rateBuffer.length = 0; appState.lastTick = performance.now(); }
function pushRate(tsMs){
  appState.rateBuffer.push(tsMs);
  const cutoff = tsMs - clampRateWindowMs;
  while(appState.rateBuffer.length && appState.rateBuffer[0] < cutoff){ appState.rateBuffer.shift(); }
}
function getRate(){ return appState.rateBuffer.length; }

function deviceKey(name, uuids){
  const n = (name || '∅').trim().toLowerCase();
  const u = (uuids && uuids[0]) ? uuids[0] : '∅';
  return n + '|' + u;
}

function updateStats(){
  el.unique.textContent = String(appState.uniqueSet.size);
  el.packets.textContent = String(appState.packetCount);
  el.rate.textContent = String(getRate());
}

function renderTable(records){
  const maxRows = 5;
  el.tblBody.innerHTML = '';
  const toShow = records.slice(-maxRows).reverse();
  for(const r of toShow){
    const tr = document.createElement('tr');
    const icon = r.icon || '';
    tr.innerHTML = `
      <td>${new Date(r.timestamp).toLocaleTimeString()}</td>
      <td>${icon} ${r.deviceName ?? ''}</td>
      <td>${(r.serviceUUIDs||[]).join(';')}</td>
      <td>${r.rssi ?? ''}</td>
      <td>${r.latitude ?? ''}</td>
      <td>${r.longitude ?? ''}</td>
      <td>${r.count ?? ''}</td>`;
    el.tblBody.appendChild(tr);
  }
  const hidden = Math.max(0, records.length - maxRows);
  el.hiddenHint.textContent = hidden > 0 ? `… ${hidden} weitere verborgen` : '';
}

async function getFiltered(){
  const all = await DB.getAllRecords();
  let rows = all;
  rows = FIL.applyFilters(rows, appState.filters);
  return rows;
}

async function refreshUI(){
  if(appState.driveMode) return;
  const rows = await getFiltered();
  const clustered = appState.cluster ? CLU.cluster5s(rows) : rows;
  renderTable(clustered);
  MAP.update(clustered);
}

async function ingest(evt){
  const position = await GEO.sample(appState.driveMode);
  const sessionId = SES.currentSessionId();
  const base = {
    timestamp: nowIso(),
    deviceName: evt.deviceName ?? null,
    serviceUUIDs: Array.isArray(evt.serviceUUIDs) ? evt.serviceUUIDs : [],
    rssi: Number.isInteger(evt.rssi) ? evt.rssi : null,
    latitude: position?.coords ? position.coords.latitude : null,
    longitude: position?.coords ? position.coords.longitude : null,
    sessionId,
    category: '', vendor: '', icon: ''
  };
  const prof = PRO.profileDevice(base.deviceName, base.serviceUUIDs);
  const record = { ...base, ...prof };

  if(record.timestamp && Array.isArray(record.serviceUUIDs) && Number.isInteger(record.rssi)){
    await DB.addRecord(record);
    appState.packetCount++;
    appState.uniqueSet.add(deviceKey(record.deviceName, record.serviceUUIDs));
    pushRate(Date.now());
    if(!appState.driveMode){ appState.renderQueue.push(record); }
    updateStats();
  }
}

BLE.onAdvertisement(async (ad) => {
  try{ await ingest(ad); } catch(e){ console.error('Ingest failed', e); }
});

el.btnPreflight.addEventListener('click', async ()=>{
  const ok = await preflight();
  el.status.textContent = ok ? 'Preflight OK' : 'Preflight: eingeschränkt';
});

el.btnStart.addEventListener('click', async ()=>{
  try{
    await DB.init();
    await GEO.init();
    SES.init();
    await BLE.startScan();
    el.btnStart.disabled = true; el.btnStop.disabled = false;
    el.status.textContent = 'Scan läuft…';
  }catch(e){
    console.error(e);
    el.status.textContent = 'Scan konnte nicht gestartet werden: ' + e.message;
  }
});

el.btnStop.addEventListener('click', async ()=>{
  await BLE.stopScan();
  el.btnStart.disabled = false; el.btnStop.disabled = true;
  el.status.textContent = 'Scan gestoppt';
});

el.toggleDrive.addEventListener('change', async (e)=>{
  appState.driveMode = !!e.target.checked;
  el.modeBadge.textContent = appState.driveMode ? 'Fahrmodus' : 'Normalmodus';
  resetRate();
  if(appState.driveMode){
    GEO.setRate('fast');
    await BLE.setRenderPaused(true);
  }else{
    GEO.setRate('normal');
    await BLE.setRenderPaused(false);
    await refreshUI();
    MAP.fitToData();
  }
});

el.toggleCluster.addEventListener('change', (e)=>{ appState.cluster = !!e.target.checked; refreshUI(); });

el.btnApplyFilters.addEventListener('click', ()=>{
  appState.filters = {
    name: el.fName.value.trim(),
    rssiMin: el.fRssiMin.value !== '' ? Number(el.fRssiMin.value) : appState.filters.rssiMin,
    rssiMax: el.fRssiMax.value !== '' ? Number(el.fRssiMax.value) : null,
    from: el.fFrom.value ? new Date(el.fFrom.value).toISOString() : null,
    to: el.fTo.value ? new Date(el.fTo.value).toISOString() : null,
  };
  refreshUI();
});

el.btnClearFilters.addEventListener('click', ()=>{
  el.fName.value=''; el.fRssiMin.value=''; el.fRssiMax.value=''; el.fFrom.value=''; el.fTo.value='';
  appState.filters = { name:'', rssiMin:-80, rssiMax:null, from:null, to:null };
  refreshUI();
});

el.btnExportJSON.addEventListener('click', async ()=>{
  const all = await DB.getAllRecords();
  EXP.exportJSON(all);
});

el.btnExportCSV.addEventListener('click', async ()=>{
  const all = await DB.getAllRecords();
  EXP.exportCSV(all);
});

el.btnExportCSVFiltered.addEventListener('click', async ()=>{
  const rows = await getFiltered();
  EXP.exportCSV(rows, 'ble-scan_filtered');
});

el.btnExportCSVCluster.addEventListener('click', async ()=>{
  const rows = await getFiltered();
  const clustered = CLU.cluster5s(rows);
  EXP.exportCSV(clustered, 'ble-scan_cluster5s');
});

async function preflight(){
  const hasBLE = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const hasGeo = !!navigator.geolocation;
  const hasWakeLock = !!(navigator.wakeLock && navigator.wakeLock.request);
  appState.preflightOk = hasBLE && hasGeo;
  document.title = `BLE Scan – ${hasBLE? 'BLE✓':'BLE×'} ${hasGeo? 'Geo✓':'Geo×'} ${hasWakeLock? 'WL✓':'WL×'}`;
  if(!('serviceWorker' in navigator)) return appState.preflightOk;
  try{ await navigator.serviceWorker.register('./service-worker.js'); }catch{}
  return appState.preflightOk;
}

(async function(){
  resetRate();
  await preflight();
  await DB.init();
  await MAP.init();
  await GEO.init();
  SES.init();
  // Default-RSSI Min in die UI spiegeln
  document.getElementById('fRssiMin').placeholder = 'RSSI min (dBm, Standard: -80)';
  el.status.textContent = 'Bereit.';
  refreshUI();
})();