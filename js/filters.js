export function applyFilters(rows, f){
  let out = rows.slice();
  if(f.from){ out = out.filter(r => r.timestamp >= f.from); }
  if(f.to){ out = out.filter(r => r.timestamp <= f.to); }
  if(Number.isFinite(f.rssiMin)){ out = out.filter(r => Number.isFinite(r.rssi) && r.rssi >= f.rssiMin); }
  if(Number.isFinite(f.rssiMax)){ out = out.filter(r => Number.isFinite(r.rssi) && r.rssi <= f.rssiMax); }
  if(f.name){ const s = f.name.toLowerCase(); out = out.filter(r => (r.deviceName||'').toLowerCase().includes(s)); }
  return out;
}
