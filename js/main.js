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

// Diagnostics
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

// App state
const appState = {
  driveMode: false,
  cluster: true,
  packetCount: 0,
  uniqueSet: new Set(),
  rateBuffer: [],
  lastTick: 0,
  preflightOk: false,
  filters: { name:'', rssiMin:-80, rssiMax:null, from:null, to:null },
  wakeLock: null,
  pathLossN: 2.0,
  lastPacketIso: null,
  lastMapUpdate: 0,
  lastAdvTs: Date.now(),
};

// Elements
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
  btnResync: document.getElementById('btnResync'),
  hb: document.getElementById('hb'),
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

// Helpers
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
  const ref = Number.isFinite(txPower) ? txPower : -59;
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n)) : 2.0;
  const d = Math.pow(10, (ref - rssi)/(10*N));
  const clamped = Math.max(0.1, Math.min(50, d));
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : null;
}

// Rendering
function renderTable(records){
  const maxRows = 5;
  el.tblBody.innerHTML = '';
  const toShow = records.slice(-maxRows).reverse();
  for(const r of toShow){
    const tr = document.createElement('tr');
    const icon = r.icon || '📡';
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

function updateMapThrottled(rows){
  const now = Date.now();
  if(!appState.driveMode){
    MAP.update(rows); appState.lastMapUpdate = now; return;
  }
  if(now - appState.lastMapUpdate > 3000){
    MAP.update(rows); appState.lastMapUpdate = now;
  }
}

async function refreshUI(){
  const rows = await getFiltered();
  const clustered = appState.cluster ? CLU.cluster5s(rows, appState.pathLossN) : rows;
  renderTable(clustered);
  updateMapThrottled(clustered);
}

// Ingest
async function ingest(evt){
  const position = await GEO.sample(appState.driveMode);
  const sessionId = SES.currentSessionId();
  const base = {
    timestamp: nowIso(),
    deviceName: evt.deviceName ?? null,
    serviceUUIDs: Array.isArray(evt.serviceUUIDs) ? evt.serviceUUIDs : [],
    rssi: Number.isInteger(evt.rssi) ? evt.rssi : null,
    txPower: (Number.isInteger(evt.txPower) && evt.txPower > -100 && evt.txPower < 30) ? evt.txPower : null,
    latitude: position?.coords ? position.coords.latitude : null,
    longitude: position?.coords ? position.coords.longitude : null,
    sessionId,
    category: '', vendor: '', icon: '',
    manufacturerData: DEC.mfgToObject(evt.manufacturerData),
    serviceData: DEC.svcToObject(evt.serviceData),
    ...DEC.decode(evt.manufacturerData, evt.serviceData)
  };
  base.distanceM = estDistance(base.rssi, base.txPower, appState.pathLossN);
  let prof = PRO.profileDevice(base.deviceName, base.serviceUUIDs);
  let record = { ...base, ...prof };
  const fb = PRO.fallbackProfileByDecoded(record);
  record = { ...record, ...fb };

  if(record.timestamp && Array.isArray(record.serviceUUIDs) && Number.isInteger(record.rssi)){
    await DB.addRecord(record);
    appState.packetCount++;
    appState.uniqueSet.add(deviceKey(record.deviceName, record.serviceUUIDs));
    pushRate(Date.now());
    appState.lastPacketIso = record.timestamp;
    updateStats();
  }
}

BLE.onAdvertisement(async (ad) => {
  appState.lastAdvTs = Date.now();
  try{ await ingest(ad); } catch(e){ console.error('Ingest failed', e); }
});

// UI Events
if(el.btnPreflight){
  el.btnPreflight.addEventListener('click', async ()=>{
    try{
      const report = await diagnostics();
      const okScan = report.find(r=>r.name==='requestLEScan')?.ok;
      if(el.btnStart){ el.btnStart.disabled = !okScan; }
      if(el.btnStart && !okScan){ el.btnStart.title = 'Browser unterstützt requestLEScan nicht. Siehe Preflight-Hinweise.'; }
      const ok = await preflight();
      if(el.status) el.status.textContent = ok ? 'Preflight OK' : 'Preflight: eingeschränkt';
    }catch(e){ console.error(e); showError('Preflight-Fehler: '+e.message); }
  });
}

if(el.btnStart){
  el.btnStart.addEventListener('click', async ()=>{
    try{
      await DB.init();
      await GEO.init();
      SES.init();
      await BLE.startScan();
      el.btnStart.disabled = true; if(el.btnStop) el.btnStop.disabled = false;
      if(el.status) el.status.textContent = 'Scan läuft…';
    }catch(e){
      console.error(e);
      if(el.status) el.status.textContent = 'Scan konnte nicht gestartet werden: ' + e.message;
      showError('Scan-Start fehlgeschlagen: '+e.message+' — Prüfe Browser/Flags/Berechtigungen.');
    }
  });
}

if(el.btnResync){ el.btnResync.addEventListener('click', async ()=>{ try{ await BLE.stopScan(); }catch{} try{ await BLE.startScan(); }catch(e){ showError('Resync fehlgeschlagen: '+e.message); } }); }

if(el.btnStop){
  el.btnStop.addEventListener('click', async ()=>{
    await BLE.stopScan();
    await releaseWakeLock();
    if(el.btnStart) el.btnStart.disabled = false; el.btnStop.disabled = true;
    if(el.status) el.status.textContent = 'Scan gestoppt';
  });
}

if(el.toggleDrive){
  el.toggleDrive.addEventListener('change', async (e)=>{
    appState.driveMode = !!e.target.checked;
    if(el.modeBadge) el.modeBadge.textContent = appState.driveMode ? 'Fahrmodus' : 'Normalmodus';
    if(el.ticker) el.ticker.classList.toggle('hidden', !appState.driveMode);
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
}

if(el.toggleCluster){
  el.toggleCluster.addEventListener('change', ()=>{ appState.cluster = !!el.toggleCluster.checked; refreshUI(); });
}

if(el.btnApplyFilters){
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
}

if(el.btnClearFilters){
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
}

if(el.btnExportJSON){ el.btnExportJSON.addEventListener('click', async ()=>{ const all = await DB.getAllRecords(); EXP.exportJSON(all); }); }
if(el.btnExportCSV){ el.btnExportCSV.addEventListener('click', async ()=>{ const all = await DB.getAllRecords(); EXP.exportCSV(all); }); }
if(el.btnExportCSVFiltered){ el.btnExportCSVFiltered.addEventListener('click', async ()=>{ const rows = await getFiltered(); EXP.exportCSV(rows, 'ble-scan_filtered'); }); }
if(el.btnExportCSVCluster){ el.btnExportCSVCluster.addEventListener('click', async ()=>{ const rows = await getFiltered(); const clustered = CLU.cluster5s(rows, appState.pathLossN); EXP.exportCSV(clustered, 'ble-scan_cluster5s'); }); }

// Preflight & boot
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
        for(const r of regs){ await r.unregister(); }
      }
    }catch(e){ console.warn('SW reg fail', e); }
  }
  return appState.preflightOk;
}

// Ticker
let dotPhase = 0;
setInterval(()=>{
  if(!appState.driveMode) return;
  dotPhase = (dotPhase + 1) % 3;
  if(el.dots) el.dots.textContent = '•'.repeat(dotPhase+1);
  updateStats();
  const s = Math.floor((Date.now() - appState.lastAdvTs)/1000);
  if(el.hb) el.hb.textContent = s+'s seit letztem Paket';
  refreshUI();
}, 1000);


// Watchdog: restart scan if no adverts for >20s
setInterval(async ()=>{
  const silentMs = Date.now() - appState.lastAdvTs;
  if(appState.preflightOk && silentMs > 20000){
    console.warn('Watchdog: keine Advertisements seit', silentMs, 'ms → Restart Scan');
    try{ await BLE.stopScan(); }catch{}
    try{ await BLE.startScan(); }catch(e){ console.warn('Restart failed', e); }
    appState.lastAdvTs = Date.now();
  }
}, 5000);

// Resubscribe when page becomes visible
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState === 'visible' && appState.preflightOk){
    try{ await BLE.stopScan(); }catch{}
    try{ await BLE.startScan(); }catch(e){ console.warn('Resubscribe failed', e); }
  }
});


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
    if(el.status) el.status.textContent = ok ? 'Bereit.' : 'Eingeschränkt, siehe Preflight.';
    await refreshUI();
  }catch(e){
    console.error(e);
    showError('Initialisierungsfehler: '+e.message);
  }
})();
