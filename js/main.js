import * as BLE from './ble.js';
import * as GEO from './geo.js';
import * as DB from './storage.js';
import * as MAP from './map.js';
import * as FIL from './filters.js';
import * as EXP from './export.js';
import * as CLU from './cluster.js';
import * as PRO from './profiler.js';
import * as SES from './session.js';
import * as DEC from './parse.js';

// --- Diagnostics ---
async function diagnostics(){
  const pf = [];
  const add = (name, ok, info='') => pf.push({name, ok, info});
  add('SecureContext (HTTPS)', window.isSecureContext === true, location.protocol);
  const ua = navigator.userAgent;
  add('Browser', true, ua);
  add('navigator.bluetooth', !!navigator.bluetooth);
  add('requestLEScan', !!(navigator.bluetooth && navigator.bluetooth.requestLEScan));
  add('Geolocation', !!navigator.geolocation);
  add('WakeLock', !!(navigator.wakeLock && navigator.wakeLock.request));
  try{
    const perms = navigator.permissions;
    if(perms && perms.query){
      try{ const g = await perms.query({name:'geolocation'}); add('Perm: Geolocation', g.state !== 'denied', g.state); }catch{}
      try{ const n = await perms.query({name:'notifications'}); add('Perm: Notifications', n.state !== 'denied', n.state); }catch{}
    }
  }catch{}
  const el = document.getElementById('pfList');
  if(el){
    el.innerHTML = '<ul>' + pf.map(p=>`<li>${p.ok?'✅':'❌'} <b>${p.name}</b> <small class="muted">${p.info||''}</small></li>`).join('') + '</ul>';
  }
  return pf;
}

// --- App State ---
const appState = {
  driveMode: false,
  cluster: true,
  packetCount: 0,
  uniqueSet: new Set(),
  rateBuffer: [],
  lastTick: 0,
  renderQueue: [],
  preflightOk: false,
  filters: { name:'', rssiMin:-80, rssiMax:null, from:null, to:null },
  wakeLock: null,
  pathLossN: 2.0,
  lastPacketIso: null,
};

// --- Elements ---
const el = {
  status: document.getElementById('status'),
  modeBadge: document.getElementById('modeBadge'),
  unique: document.getElementById('uniqueCount'),
  packets: document.getElementById('packetCount'),
  rate: document.getElementById('ratePerMin'),
  lastPkt: document.getElementById('lastPkt'),
  dots: document.getElementById('dots'),
  ticker: document.getElementById('driveTicker'),
  tblBody: document.getElementById('tblBody'),
  hiddenHint: document.getElementById('hiddenHint'),
  btnPreflight: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  swToggle: document.getElementById('toggleSW'),
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
  pathLossN: document.getElementById('pathLossN'),
};

// --- Helpers ---
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
  el.lastPkt.textContent = appState.lastPacketIso ? new Date(appState.lastPacketIso).toLocaleTimeString() : '–';
}
function showError(msg){ const e = document.getElementById('err'); if(!e) return; e.textContent = msg||''; e.classList.toggle('hidden', !msg); }

function estDistance(rssi, txPower, n){
  if(!Number.isFinite(rssi)) return null;
  const ref = Number.isFinite(txPower) ? txPower : -59; // fallback
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n)) : 2.0;
  const d = Math.pow(10, (ref - rssi)/(10*N));
  const clamped = Math.max(0.1, Math.min(50, d));
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : null;
}

// --- Rendering ---
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
      <td>${r.txPower ?? ''}</td>
      <td>${r.distanceM ?? ''}</td>
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
  const rows = await getFiltered();
  const clustered = appState.cluster ? CLU.cluster5s(rows, appState.pathLossN) : rows;
  renderTable(clustered);
  if(!appState.driveMode){ MAP.update(clustered); }
}

// --- Ingest ---
async function ingest(evt){
  const position = await GEO.sample(appState.driveMode);
  const sessionId = SES.currentSessionId();
  const base = {
    timestamp: nowIso(),
    deviceName: evt.deviceName ?? null,
    serviceUUIDs: Array.isArray(evt.serviceUUIDs) ? evt.serviceUUIDs : [],
    rssi: Number.isInteger(evt.rssi) ? evt.rssi : null,
    txPower: Number.isInteger(evt.txPower) ? evt.txPower : null,
    latitude: position?.coords ? position.coords.latitude : null,
    longitude: position?.coords ? position.coords.longitude : null,
    sessionId,
    category: '', vendor: '', icon: '',
    manufacturerData: DEC.mfgToObject(evt.manufacturerData),
    serviceData: DEC.svcToObject(evt.serviceData),
    ...DEC.decode(evt.manufacturerData, evt.serviceData)
  };
  base.distanceM = estDistance(base.rssi, base.txPower, appState.pathLossN);
  const prof = PRO.profileDevice(base.deviceName, base.serviceUUIDs);
  const record = { ...base, ...prof };

  if(record.timestamp && Array.isArray(record.serviceUUIDs) && Number.isInteger(record.rssi)){
    await DB.addRecord(record);
    appState.packetCount++;
    appState.uniqueSet.add(deviceKey(record.deviceName, record.serviceUUIDs));
    pushRate(Date.now());
    appState.lastPacketIso = record.timestamp;
    if(!appState.driveMode){ appState.renderQueue.push(record); }
    updateStats();
  }
}

// --- BLE hooks ---
BLE.onAdvertisement(async (ad) => {
  try{ await ingest(ad); } catch(e){ console.error('Ingest failed', e); }
});

// --- UI Events ---
el.btnPreflight.addEventListener('click', async ()=>{
  try{
    const report = await diagnostics();
    const okScan = report.find(r=>r.name==='requestLEScan')?.ok;
    el.btnStart.disabled = !okScan;
    if(!okScan){ el.btnStart.title = 'Browser unterstützt requestLEScan nicht. Siehe Preflight-Hinweise.'; }
    const ok = await preflight();
    el.status.textContent = ok ? 'Preflight OK' : 'Preflight: eingeschränkt';
  }catch(e){ console.error(e); showError('Preflight-Fehler: '+e.message); }
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
    showError('Scan-Start fehlgeschlagen: '+e.message+' — Prüfe Browser/Flags/Berechtigungen.');
  }
});

el.btnStop.addEventListener('click', async ()=>{
  await BLE.stopScan();
  await releaseWakeLock();
  el.btnStart.disabled = false; el.btnStop.disabled = true;
  el.status.textContent = 'Scan gestoppt';
});

el.toggleDrive.addEventListener('change', async (e)=>{
  appState.driveMode = !!e.target.checked;
  el.modeBadge.textContent = appState.driveMode ? 'Fahrmodus' : 'Normalmodus';
  el.ticker.classList.toggle('hidden', !appState.driveMode);
  resetRate();
  if(appState.driveMode){
    GEO.setRate('fast');
    await requestWakeLock();
  }else{
    GEO.setRate('normal');
    await releaseWakeLock();
    await refreshUI();
    MAP.fitToData();
  }
});

el.toggleCluster.addEventListener('change', (e)=>{ appState.cluster = !!e.target.checked; refreshUI(); });

el.btnApplyFilters.addEventListener('click', ()=>{
  appState.filters = {
    name: el.fName?.value.trim() || '',
    rssiMin: el.fRssiMin?.value !== '' ? Number(el.fRssiMin.value) : appState.filters.rssiMin,
    rssiMax: el.fRssiMax?.value !== '' ? Number(el.fRssiMax.value) : null,
    from: el.fFrom?.value ? new Date(el.fFrom.value).toISOString() : null,
    to: el.fTo?.value ? new Date(el.fTo.value).toISOString() : null,
  };
  appState.pathLossN = parseFloat(el.pathLossN?.value) || 2.0;
  refreshUI();
});

el.btnClearFilters.addEventListener('click', ()=>{
  if(el.fName) el.fName.value='';
  if(el.fRssiMin) el.fRssiMin.value='';
  if(el.fRssiMax) el.fRssiMax.value='';
  if(el.fFrom) el.fFrom.value='';
  if(el.fTo) el.fTo.value='';
  if(el.pathLossN) el.pathLossN.value='2.0';
  appState.filters = { name:'', rssiMin:-80, rssiMax:null, from:null, to:null };
  appState.pathLossN = 2.0;
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
  const clustered = CLU.cluster5s(rows, appState.pathLossN);
  EXP.exportCSV(clustered, 'ble-scan_cluster5s');
});

// --- Preflight & boot ---
async function preflight(){
  const hasBLE = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const hasGeo = !!navigator.geolocation;
  const hasWakeLock = !!(navigator.wakeLock && navigator.wakeLock.request);
  appState.preflightOk = hasBLE && hasGeo;
  document.title = `BLE Scan – ${hasBLE? 'BLE✓':'BLE×'} ${hasGeo? 'Geo✓':'Geo×'} ${hasWakeLock? 'WL✓':'WL×'}`;
  if('serviceWorker' in navigator){
    try{
      if(el.swToggle?.checked){
        await navigator.serviceWorker.register('./service-worker.js');
      }else{
        const regs = await navigator.serviceWorker.getRegistrations();
        for(const r of regs){ r.unregister(); }
      }
    }catch(e){ console.warn('SW reg fail', e); }
  }
  return appState.preflightOk;
}

// Drive ticker animation
let dotPhase = 0;
setInterval(()=>{
  if(!appState.driveMode) return;
  dotPhase = (dotPhase + 1) % 3;
  if(el.dots) el.dots.textContent = '•'.repeat(dotPhase+1);
  updateStats();
}, 1000);

// WakeLock helpers
async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      appState.wakeLock = await navigator.wakeLock.request('screen');
      appState.wakeLock.addEventListener('release', ()=>{ console.log('WakeLock released'); });
      document.addEventListener('visibilitychange', async ()=>{
        if(document.visibilityState === 'visible' && appState.driveMode){
          try{ appState.wakeLock = await navigator.wakeLock.request('screen'); }catch{}
        }
      });
    }
  }catch(e){ console.warn('WakeLock not granted', e); }
}
async function releaseWakeLock(){
  try{ await appState.wakeLock?.release(); }catch{}
  appState.wakeLock = null;
}

// Boot
(async function(){
  try{
    resetRate();
    await diagnostics();
    const ok = await preflight();
    try{ await MAP.init(); }catch(e){ console.error(e); showError('Karte konnte nicht initialisiert werden. Prüfe CSP/Netzwerk.'); }
    await DB.init();
    await GEO.init();
    SES.init();
    el.status.textContent = ok ? 'Bereit.' : 'Eingeschränkt, siehe Preflight.';
    refreshUI();
  }catch(e){
    console.error(e);
    showError('Initialisierungsfehler: '+e.message);
  }
})();
