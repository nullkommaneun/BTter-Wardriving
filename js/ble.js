// ble.js — robust Web Bluetooth LE scan wrapper
let scanRef = null;
let advHandler = null;

export function onAdvertisement(cb){ advHandler = cb; }

export async function startScan(){
  if(!navigator.bluetooth){ throw new Error('Web Bluetooth nicht verfügbar'); }
  try{
    scanRef = await navigator.bluetooth.requestLEScan({
      keepRepeatedDevices: true,
      acceptAllAdvertisements: true
    });
  }catch(e){
    throw new Error('requestLEScan nicht möglich: ' + (e && e.message || e));
  }
  navigator.bluetooth.addEventListener('advertisementreceived', onAdv);
}

export async function stopScan(){
  try{ if(scanRef && scanRef.active && scanRef.stop) scanRef.stop(); }catch{}
  try{ navigator.bluetooth.removeEventListener('advertisementreceived', onAdv); }catch{}
  scanRef = null;
}

function bufToHex(buf){
  if(!buf) return '';
  const v = new Uint8Array(buf);
  let s = '';
  for(let i=0;i<v.length;i++) s += v[i].toString(16).padStart(2,'0');
  return s;
}

function mapToObj(map){
  // Convert BluetoothDataMap (Map<uuid, DataView>) to { uuid: "hex" }
  const out = {};
  if(!map || typeof map.forEach !== 'function') return out;
  map.forEach((val, key)=>{
    try{
      const hex = val && val.buffer ? bufToHex(val.buffer) : '';
      out[String(key)] = hex;
    }catch(_){ out[String(key)] = ''; }
  });
  return out;
}

function onAdv(ev){
  try{
    const name = ev.device?.name || ev.name || null;
    const uuids = Array.from(new Set([...(ev.uuids||[]), ...(ev.serviceUuids||[]), ...(ev.serviceUUIDs||[])]));
    const rssi = Number.isFinite(ev.rssi) ? Math.trunc(ev.rssi) : null;
    const txPower = Number.isFinite(ev.txPower) ? Math.trunc(ev.txPower) : null;
    const ad = {
      timestamp: new Date().toISOString(),
      deviceName: name,
      serviceUUIDs: uuids,
      rssi,
      txPower,
      manufacturerData: mapToObj(ev.manufacturerData),
      serviceData: mapToObj(ev.serviceData)
    };
    if(typeof advHandler === 'function') advHandler(ad);
  }catch(e){
    console.error('Anzeigeverarbeitung fehlgeschlagen:', e);
  }
}
