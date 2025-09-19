// js/ble.js — Hybrid BLE helpers (global scan + watches)
let globalScan = null;
let advHandler = null;
const watches = new Map(); // id -> { dev, handler, active }

export function setAdvertisementHandler(fn){
  advHandler = fn;
}

function hexFromView(view){
  if(!view) return '';
  const v = new Uint8Array(view.buffer || view);
  let s=''; for(let i=0;i<v.length;i++){ s += v[i].toString(16).padStart(2, '0'); }
  return s;
}

function emitFromEvent(e){
  if(!advHandler) return;
  const name = e.device?.name || '';
  const rssi = (typeof e.rssi === 'number') ? e.rssi : null;
  const tx   = (typeof e.txPower === 'number') ? e.txPower : null;
  const serviceUUIDs = Array.isArray(e.uuids) ? e.uuids.slice() : [];
  const m = {}; e.manufacturerData?.forEach((val, key)=>{ m[String(key)] = hexFromView(val); });
  const s = {}; e.serviceData?.forEach((val, key)=>{ s[String(key)] = hexFromView(val); });
  advHandler({
    timestamp: new Date().toISOString(),
    deviceId: e.device?.id || null,
    deviceName: name || null,
    serviceUUIDs,
    rssi: Number.isInteger(rssi) ? rssi : (rssi!==null ? Math.round(rssi) : null),
    txPower: tx,
    manufacturerData: m,
    serviceData: s
  });
}

export async function startGlobalScan(){
  if(!navigator.bluetooth || !navigator.bluetooth.requestLEScan){
    throw new Error('requestLEScan nicht verfügbar');
  }
  stopGlobalScan();
  const scan = await navigator.bluetooth.requestLEScan({
    keepRepeatedDevices: true,
    acceptAllAdvertisements: true
  });
  globalScan = scan;
  navigator.bluetooth.addEventListener('advertisementreceived', emitFromEvent);
  return true;
}

export function stopGlobalScan(){
  try{ navigator.bluetooth.removeEventListener('advertisementreceived', emitFromEvent); }catch(_){}
  try{ globalScan && globalScan.stop && globalScan.stop(); }catch(_){}
  globalScan = null;
}

export async function addWatch(){
  if(!navigator.bluetooth || !navigator.bluetooth.requestDevice){
    throw new Error('requestDevice nicht verfügbar');
  }
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [] });
  if(!dev) return null;
  const id = dev.id || (dev.name||'unknown') + '#' + Math.random().toString(36).slice(2,7);
  const handler = (e)=> emitFromEvent(e);
  dev.addEventListener('advertisementreceived', handler);
  await dev.watchAdvertisements();
  watches.set(id, { dev, handler, active: true });
  return { id, name: dev.name || '', active: true };
}

export function stopWatch(id){
  const w = watches.get(id);
  if(!w) return;
  try{ w.dev.removeEventListener('advertisementreceived', w.handler); }catch(_){}
  w.active = false;
}

export function listWatches(){
  const out = [];
  for(const [id, w] of watches){
    out.push({ id, name: w.dev.name || '', active: !!w.active });
  }
  return out;
}