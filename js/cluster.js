export function cluster5s(rows){
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
      buckets.set(k, { ...r, uuSet: new Set(r.serviceUUIDs||[]), count: 1 });
    }else{
      prev.timestamp = r.timestamp; // last
      prev.rssi = Math.max(prev.rssi ?? -999, r.rssi ?? -999);
      prev.txPower = (Number.isInteger(r.txPower) ? (Math.max(prev.txPower ?? -999, r.txPower)) : prev.txPower);
      if(Number.isFinite(r.latitude) && Number.isFinite(r.longitude)){
        prev.latitude = r.latitude; prev.longitude = r.longitude;
      }
      (r.serviceUUIDs||[]).forEach(u => prev.uuSet.add(u));
      prev.count += 1;
    }
  }
  for(const v of buckets.values()){
    v.serviceUUIDs = Array.from(v.uuSet);
    delete v.uuSet;
    out.push(v);
  }
  return out.sort((a,b)=> a.timestamp.localeCompare(b.timestamp));
}

function deviceKey(r){
  const n = (r.deviceName || '∅').trim().toLowerCase();
  const u = (r.serviceUUIDs && r.serviceUUIDs[0]) ? r.serviceUUIDs[0] : '∅';
  return n + '|' + u;
}
