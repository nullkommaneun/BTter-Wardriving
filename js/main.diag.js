// main.single.js – vollständiger Test-Scanner ohne Importe (RAM-Only)
const el = {
  probe: document.getElementById('jsProbe'),
  pf: document.getElementById('preflightStatus'),
  status: document.getElementById('status'),
  btnPre: document.getElementById('btnPreflight'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnResync: document.getElementById('btnResync'),
  cntU: document.getElementById('cntUnique'),
  cntP: document.getElementById('cntPackets'),
  heartbeat: document.getElementById('heartbeat'),
  devList: document.getElementById('devList'),
};
if (el.probe) el.probe.textContent = 'JS-Modul geladen (Single)';

let scanning = false;
let lastTs = 0;
const records = [];
const uniq = new Set();

function setPF(msg){ if(el.pf) el.pf.textContent = msg; if(el.status) el.status.textContent = msg; }
function setStatus(msg){ if(el.status) el.status.textContent = msg; }
function nowISO(){ return new Date().toISOString(); }

async function preflight(){
  const okBLE  = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const okGeo  = !!navigator.geolocation;
  const okWake = !!(navigator.wakeLock && navigator.wakeLock.request);
  const msg = `Preflight: requestLEScan:${okBLE?'OK':'NEIN'} | Geolocation:${okGeo?'OK':'NEIN'} | WakeLock:${okWake?'OK':'NEIN'}`;
  setPF(msg);
  return okBLE;
}

function deviceKey(name, uuids){
  const n = (name||'∅').trim().toLowerCase();
  const u = (Array.isArray(uuids)&&uuids[0])? uuids[0] : '∅';
  return n+'|'+u;
}

function hexFromView(view){
  if(!view) return '';
  let s=''; const v=new Uint8Array(view.buffer||view);
  for(let i=0;i<v.length;i++){ s += v[i].toString(16).padStart(2,'0'); }
  return s;
}

function listRender(){
  if(!el.devList) return;
  el.devList.innerHTML = '';
  const counts = new Map();
  for(const r of records){
    const k = deviceKey(r.deviceName, r.serviceUUIDs);
    counts.set(k, (counts.get(k)||0)+1);
  }
  const items = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,50);
  for(const [k,c] of items){
    const li = document.createElement('li');
    li.textContent = `${k} — ${c} Pakete`;
    el.devList.appendChild(li);
  }
}

async function startScan(){
  const ok = await preflight();
  if(!ok) throw new Error('requestLEScan nicht verfügbar');
  const scan = await navigator.bluetooth.requestLEScan({
    keepRepeatedDevices: true,
    acceptAllAdvertisements: true
  });
  scanning = true;
  setStatus('Scan läuft…');

  function onAdv(e){
    try{
      const name = e.device && e.device.name || '';
      const rssi = typeof e.rssi === 'number' ? e.rssi : null;
      const tx  = typeof e.txPower === 'number' ? e.txPower : null;

      // UUIDs (nur wenn vom UA geliefert)
      const serviceUUIDs = Array.isArray(e.uuids) ? e.uuids.slice() : [];

      // manufacturerData/serviceData in einfache Objekte
      const m = {};
      if(e.manufacturerData && e.manufacturerData.forEach){
        e.manufacturerData.forEach((val, key)=>{ m[String(key)] = hexFromView(val); });
      }
      const s = {};
      if(e.serviceData && e.serviceData.forEach){
        e.serviceData.forEach((val, key)=>{ s[String(key)] = hexFromView(val); });
      }

      const rec = {
        timestamp: nowISO(),
        deviceName: name || null,
        serviceUUIDs,
        rssi: (Number.isInteger(rssi)? rssi : (rssi!==null? Math.round(rssi): null)),
        txPower: tx,
        manufacturerData: m,
        serviceData: s
      };
      records.push(rec);
      lastTs = Date.now();

      const k = deviceKey(rec.deviceName, rec.serviceUUIDs);
      uniq.add(k);
      if(el.cntU) el.cntU.textContent = String(uniq.size);
      if(el.cntP) el.cntP.textContent = String(records.length);
      listRender();
    }catch(err){
      console.error('Adv-Parse-Fehler', err);
    }
  }

  navigator.bluetooth.addEventListener('advertisementreceived', onAdv);

  // Heartbeat
  const hb = setInterval(()=>{
    const silent = Math.floor((Date.now()-lastTs)/1000);
    if(el.heartbeat) el.heartbeat.textContent = `letztes Paket vor ${silent}s`;
    if(scanning && silent > 20){
      // Quick resubscribe: stop+start
      try{ navigator.bluetooth.removeEventListener('advertisementreceived', onAdv); }catch(_){}
      try{ navigator.bluetooth.requestLEScan({keepRepeatedDevices:true, acceptAllAdvertisements:true}); }catch(_){}
      lastTs = Date.now();
    }
  }, 1000);

  // Stop-Handler
  el.btnStop?.addEventListener('click', async ()=>{
    try{
      scanning = false;
      try{ navigator.bluetooth.removeEventListener('advertisementreceived', onAdv); }catch(_){}
      try{ scan.stop && scan.stop(); }catch(_){}
      clearInterval(hb);
      setStatus('Scan gestoppt');
    }catch(e){ setStatus('Stop-Fehler: '+e.message); }
  }, { once:true });
}

document.getElementById('btnPreflight')?.addEventListener('click', preflight);
document.getElementById('btnStart')?.addEventListener('click', async ()=>{
  try{ await startScan(); } catch(e){ setStatus('Start-Fehler: '+e.message); }
});
document.getElementById('btnResync')?.addEventListener('click', async ()=>{
  try{ await startScan(); } catch(e){ setStatus('Resync-Fehler: '+e.message); }
});

document.addEventListener('DOMContentLoaded', preflight);
