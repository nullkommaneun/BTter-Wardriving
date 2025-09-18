let scanRef = null;
let pausedRender = false;
let advHandler = null;

export function onAdvertisement(cb){ advHandler = cb; }
export async function setRenderPaused(p){ pausedRender = !!p; }

export async function startScan(){
  if(!navigator.bluetooth){ throw new Error('Web Bluetooth nicht verfügbar'); }
  try{
    scanRef = await navigator.bluetooth.requestLEScan({
      keepRepeatedDevices: true,
      acceptAllAdvertisements: true
    });
  }catch(e){
    throw new Error('requestLEScan nicht möglich: ' + e.message);
  }
  navigator.bluetooth.addEventListener('advertisementreceived', onAdv);
}

export async function stopScan(){
  try{ if(scanRef && scanRef.active && scanRef.stop) scanRef.stop(); }catch{}
  navigator.bluetooth.removeEventListener('advertisementreceived', onAdv);
  scanRef = null;
}

function onAdv(ev){
  const name = ev.device?.name || ev.name || null;
  const uuids = Array.from(new Set([...(ev.uuids||[]), ...(ev.serviceUuids||[]), ...(ev.serviceUUIDs||[])]));
  const rssi = Number.isFinite(ev.rssi) ? Math.trunc(ev.rssi) : (Number.isFinite(ev.txPower) ? Math.trunc(ev.txPower) : null);
  const ad = { deviceName: name, serviceUUIDs: uuids, rssi };
  if(!pausedRender && typeof advHandler === 'function') advHandler(ad);
}
