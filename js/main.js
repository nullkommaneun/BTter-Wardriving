import * as BLE from './ble.js';
import * as GEO from './geo.js';
import * as DB from './storage.js';
import * as FIL from './filters.js';
import * as EXP from './export.js';
import * as CLU from './cluster.js';
import * as PRO from './profiler.js';
import * as SES from './session.js';
import * as DEC from './parse.js';

// Diagnostics
const errBanner = document.getElementById('errorBanner');
window.addEventListener('error', (e)=>{ console.error('Uncaught', e.error || e.message); if(errBanner){ errBanner.style.display='block'; errBanner.textContent = 'Fehler: '+(e.message||'unbekannt'); } });
window.addEventListener('unhandledrejection', (e)=>{ console.error('Unhandled rejection', e.reason); if(errBanner){ errBanner.style.display='block'; errBanner.textContent = 'Fehler: '+(e.reason?.message||'Promise abgelehnt'); } });

async function diagnostics(){
  const pf = [];
  const add = (name, ok, info='') => pf.push({name, ok, info});
  add('SecureContext (HTTPS)', window.isSecureContext === true, location.protocol);
  const ua = navigator.userAgent;
  add('Browser', true, ua);
  add('navigator.bluetooth', !!navigator.bluetooth);
  add('requestLEScan', !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  add('Geolocation', !!navigator.geolocation);
  add('WakeLock', !!(navigator.wakeLock && navigator.wakeLock.request);
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
  rssiEma: new Map(),
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
function onSafe(el, ev, fn, opts){ if(el && el.addEventListener){ el.addEventListener(ev, fn, opts); } }

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
  el.rate.textContent = String(getRate();
  el.lastPkt.textContent = appState.lastPacketIso ? new Date(appState.lastPacketIso).toLocaleTimeString() : '–';
}
function showError(msg){ const e = document.getElementById('err'); if(!e) return; e.textContent = msg||''; e.classList.toggle('hidden', !msg); }

function estDistance(rssi, txPower, n){
  if(!Number.isFinite(rssi) return null;
  const ref = Number.isFinite(txPower) ? txPower : -59;
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n) : 2.0;
  const d = Math.pow(10, (ref - rssi)/(10*N);
  const clamped = Math.max(0.1, Math.min(50, d);
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2) : null;
}


function ema(prev, x, alpha=0.3){
  if(!Number.isFinite(x) return prev ?? null;
  if(!Number.isFinite(prev) return x;
  return (1-alpha)*prev + alpha*x;
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
    /* map removed call */ appState.lastMapUpdate = now; return;
  }
  if(now - appState.lastMapUpdate > 3000){
    /* map removed call */ appState.lastMapUpdate = now;
  }
}

async function refreshUI(){
  const rows = await getFiltered();
  const clustered = appState.cluster ? CLU.cluster5s(rows, appState.pathLossN) : rows;
  renderTable(clustered);
  devicesIndex = summarizeDevices(clustered);
  renderDevList();
  
}


// ==== Geräte-Analyse ====
const devEl = {
  list: document.getElementById('devList'),
  search: document.getElementById('devSearch'),
  count: document.getElementById('devCount'),
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
  spark: document.getElementById('anaSpark'),
  btnExportJSONOne: document.getElementById('btnExportJSONOne'),
  btnExportCSVOne: document.getElementById('btnExportCSVOne'),
  btnFilterOnly: document.getElementById('btnFilterOnly'),
};

let devicesIndex = new Map();
let selectedKey = null;

function keyOf(rec){
  const n = (rec.deviceName || '∅').trim().toLowerCase();
  const u = (rec.serviceUUIDs && rec.serviceUUIDs[0]) ? rec.serviceUUIDs[0] : '∅';
  return n + '|' + u;
}

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
    if(Number.isFinite(r.rssi) entry.rssiVals.push(r.rssi);
    if(Number.isFinite(r.distanceM) entry.distVals.push(r.distanceM);
    (r.serviceUUIDs||[]).forEach(u=> entry.uuids.add(u);
    entry.lastRaw = { manufacturerData: r.manufacturerData || {}, serviceData: r.serviceData || {} };
    entry.samples.push({ ts: r.timestamp, rssi: r.rssi, dist: r.distanceM });
  }
  return map;
}

function median(arr){ if(!arr.length) return null; const a=arr.slice().sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2? a[m] : (a[m-1]+a[m])/2; }
function mean(arr){ if(!arr.length) return null; return arr.reduce((a,b)=>a+b,0)/arr.length; }

function renderDevList(){
  const filterText = (devEl.search?.value || '').toLowerCase();
  const items = Array.from(devicesIndex.values().filter(it=>{
    if(!filterText) return true;
    const uu = Array.from(it.uuids).join(';').toLowerCase();
    return (it.name||'').toLowerCase().includes(filterText) || uu.includes(filterText);
  }).sort((a,b)=> b.count - a.count);
  devEl.list.innerHTML = '';
  for(const it of items){
    const li = document.createElement('li');
    li.innerHTML = `<div class="name"><span>${it.icon}</span><span>${it.name}</span></div><div class="meta"><span class="count">${it.count}</span> • ${(it.category||'')}</div>`;
    li&& onSafe, ()=> selectDevice(it.key);
    devEl.list.appendChild(li);
  }
  devEl.count.textContent = `${items.length} Geräte`;
}

function selectDevice(key){
  selectedKey = key;
  const it = devicesIndex.get(key);
  if(!it) return;
  devEl.anaEmpty?.classList.add('hidden');
  devEl.anaWrap?.classList.remove('hidden');
  devEl.anaIcon.textContent = it.icon || '📡';
  devEl.anaName.textContent = it.name || '(ohne Name)';
  devEl.anaCat.textContent = it.category || '–';
  devEl.anaVendor.textContent = it.vendor || '–';
  devEl.anaPackets.textContent = String(it.count);
  devEl.anaFirst.textContent = new Date(it.first).toLocaleString();
  devEl.anaLast.textContent = new Date(it.last).toLocaleString();
  const rssiAvg = mean(it.rssiVals); const rssiMed = median(it.rssiVals);
  devEl.anaRssiStats.textContent = (rssiAvg!==null? Math.round(rssiAvg):'–') + ' / ' + (rssiMed!==null? Math.round(rssiMed):'–') + ' dBm';
  const distAvg = mean(it.distVals); const distMed = median(it.distVals);
  devEl.anaDistStats.textContent = (distAvg!==null? distAvg.toFixed(1):'–') + ' / ' + (distMed!==null? distMed.toFixed(1):'–') + ' m';
  const mKeys = Object.keys(it.lastRaw.manufacturerData||{}).join(', ') || '–';
  const sKeys = Object.keys(it.lastRaw.serviceData||{}).join(', ') || '–';
  devEl.anaRawKeys.textContent = `Hersteller: ${mKeys} • Services: ${sKeys}`;
  devEl.anaRaw.textContent = JSON.stringify(it.lastRaw, null, 2);
  drawSpark(it.samples);

  devEl.btnExportJSONOne?.onclick = async ()=>{
    const rows = await DB.getAllRecords();
    const filtered = rows.filter(r => keyOf(r) === key);
    const ts = new Date().toISOString().replace(/:/g,'-');
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `device_${sanitize(it.name)}_${ts}.json`; a.click();
  };
  devEl.btnExportCSVOne?.onclick = async ()=>{
    const rows = await DB.getAllRecords();
    const filtered = rows.filter(r => keyOf(r) === key);
    const header = ['timestamp','deviceName','serviceUUIDs','rssi','txPower','distanceM','latitude','longitude','sessionId','category','vendor','icon'];
    const lines = [header.join(',')];
    for(const r of filtered){
      const uu = (r.serviceUUIDs||[]).join(';');
      const vals = [r.timestamp, r.deviceName||'', uu, r.rssi??'', r.txPower??'', r.distanceM??'', r.latitude??'', r.longitude??'', r.sessionId||'', r.category||'', r.vendor||'', r.icon||''];
      lines.push(vals.map(v => String(v).replace(/"/g,'""').map(v=>`"${v}"`).join(',');
    }
    const ts = new Date().toISOString().replace(/:/g,'-');
    const blob = new Blob([lines.join('\n')], { type:'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `device_${sanitize(it.name)}_${ts}.csv`; a.click();
  };
  devEl.btnFilterOnly?.onclick = ()=>{
    if(el.fName) el.fName.value = it.name || '';
    appState.filters.name = it.name || '';
    refreshUI();
  };
}

function sanitize(s){ return (s||'').replace(/[^a-z0-9-_]+/gi,'_').slice(0,60); }

function drawSpark(samples){
  const c = devEl.spark;
  if(!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if(!samples.length) return;
  const N = Math.min(200, samples.length);
  const arr = samples.slice(-N);
  const xs = arr.map(x=> new Date(x.ts).getTime();
  const ys = arr.map(x=> (Number.isFinite(x.rssi)? x.rssi : -100);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 8;
  const w = c.width, h = c.height;
  function xmap(v){ return pad + (w-2*pad) * ( (v-minX) / Math.max(1, maxX-minX); }
  function ymap(v){ return pad + (h-2*pad) * ( ( (v - maxY) / Math.max(1, maxY-minY) ); }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  arr.forEach((p,i)=>{
    const x = xmap(new Date(p.ts).getTime();
    const y = ymap(Number.isFinite(p.rssi)? p.rssi : -100);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();
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
  base.distanceM = estDistance(Number.isFinite(appState.rssiEma.get(deviceKey(base.deviceName, base.serviceUUIDs)) ? Math.round(appState.rssiEma.get(deviceKey(base.deviceName, base.serviceUUIDs)) : base.rssi, base.txPower, appState.pathLossN);
  const key = deviceKey(base.deviceName, base.serviceUUIDs);
  const prev = appState.rssiEma.get(key);
  const sm = ema(prev, base.rssi);
  if(Number.isFinite(sm) appState.rssiEma.set(key, sm);
  let prof = PRO.profileDevice(base.deviceName, base.serviceUUIDs);
  let record = { ...base, ...prof, rssiSmoothed: Number.isFinite(sm)? Math.round(sm): null };
  const fb = PRO.fallbackProfileByDecoded(record);
  record = { ...record, ...fb };

  if(record.timestamp && Array.isArray(record.serviceUUIDs) && Number.isInteger(record.rssi){
    await DB.addRecord(record);
    appState.packetCount++;
    appState.uniqueSet.add(deviceKey(record.deviceName, record.serviceUUIDs);
    pushRate(Date.now();
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
  el.btnPreflight&& onSafe, async ()=>{
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
  el.btnStart&& onSafe, async ()=>{
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

if(el.btnResync){ el.btnResync&& onSafe, async ()=>{ try{ await BLE.stopScan(); }catch{} try{ await BLE.startScan(); }catch(e){ showError('Resync fehlgeschlagen: '+e.message); } }); }

if(el.btnStop){
  el.btnStop&& onSafe, async ()=>{
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
      /* map removed */
    }
  });
}

if(el.toggleCluster){
  el.toggleCluster.addEventListener('change', ()=>{ appState.cluster = !!el.toggleCluster.checked; refreshUI(); });
}

if(el.btnApplyFilters){
  el.btnApplyFilters&& onSafe, ()=>{
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
  el.btnClearFilters&& onSafe, ()=>{
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

if(el.btnExportJSON){ el.btnExportJSON&& onSafe, async ()=>{ const all = await DB.getAllRecords(); EXP.exportJSON(all); }); }
if(el.btnExportCSV){ el.btnExportCSV&& onSafe, async ()=>{ const all = await DB.getAllRecords(); EXP.exportCSV(all); }); }
if(el.btnExportCSVFiltered){ el.btnExportCSVFiltered&& onSafe, async ()=>{ const rows = await getFiltered(); EXP.exportCSV(rows, 'ble-scan_filtered'); }); }
if(el.btnExportCSVCluster){ el.btnExportCSVCluster&& onSafe, async ()=>{ const rows = await getFiltered(); const clustered = CLU.cluster5s(rows, appState.pathLossN); EXP.exportCSV(clustered, 'ble-scan_cluster5s'); }); }

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
  const thr = appState.driveMode ? 12000 : 20000;
  if(appState.preflightOk && silentMs > thr){
    console.warn('Watchdog: keine Advertisements seit', silentMs, 'ms → Restart Scan');
    try{ await BLE.stopScan(); }catch{}
    try{ await BLE.startScan(); }catch(e){ console.warn('Restart failed', e); }
    appState.lastAdvTs = Date.now();
  }
}, 5000);

// Resubscribe when page becomes visible
document.addEventListener('visibilitychange', async ()=>{
  if(document.visibilityState === 'visible' && appState.preflightOk){
    try{ await EXP; }catch{}
    try{ await import('./storage.js').then(m=>m.flushNow && m.flushNow(); }catch{}
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
    try{ /* map removed */ }catch(e){ console.error(e); showError('Karte konnte nicht initialisiert werden. Prüfe CSP/Netzwerk.'); }
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
