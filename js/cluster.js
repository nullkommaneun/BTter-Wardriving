export function cluster5s(rows, pathLossN=2.0){
  const out = [];
  const buckets = new Map();
  const windowMs = 5000;
  for(const r of rows){
    const key = deviceKey(r);
    const t = new Date(r.timestamp).getTime();
    const b = Math.floor(t / windowMs);
    const k = key + '#' + b;
    const prev = buckets.get(k);
    if(!prev){
      const copy = { ...r };
      copy.uuSet = new Set(r.serviceUUIDs||[]);
      copy.count = 1;
      out.push(copy);
      buckets.set(k, copy);
    }else{
      prev.timestamp = r.timestamp;
      if(Number.isFinite(r.rssi) && (!Number.isFinite(prev.rssi) || r.rssi > prev.rssi)){
        prev.rssi = r.rssi;
        prev.txPower = r.txPower ?? prev.txPower;
      }
      if(Number.isFinite(r.latitude) && Number.isFinite(r.longitude)){
        prev.latitude = r.latitude; prev.longitude = r.longitude;
      }
      (r.serviceUUIDs||[]).forEach(u => prev.uuSet.add(u));
      prev.count += 1;
    }
  }
  const out2 = out.map(v=>{
    const rec = { ...v };
    rec.serviceUUIDs = Array.from(v.uuSet || []);
    delete rec.uuSet;
    rec.distanceM = estDistance(rec.rssi, rec.txPower, pathLossN);
    return rec;
  });
  return out2.sort((a,b)=> a.timestamp.localeCompare(b.timestamp));
}

function deviceKey(r){
  const n = (r.deviceName || '∅').trim().toLowerCase();
  const u = (r.serviceUUIDs && r.serviceUUIDs[0]) ? r.serviceUUIDs[0] : '∅';
  return n + '|' + u;
}

function estDistance(rssi, txPower, n){
  if(!Number.isFinite(rssi)) return null;
  const ref = Number.isFinite(txPower) ? txPower : -59;
  const N = Number.isFinite(n) ? Math.max(1.0, Math.min(4.0, n)) : 2.0;
  const d = Math.pow(10, (ref - rssi)/(10*N));
  const clamped = Math.max(0.1, Math.min(50, d));
  return Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : null;
}
