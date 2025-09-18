export function applyFilters(rows, f){
  let out = rows.slice();
  if(f.from){ out = out.filter(r => r.timestamp >= f.from); }
  if(f.to){ out = out.filter(r => r.timestamp <= f.to); }
  if(Number.isFinite(f.rssiMin)){ out = out.filter(r => Number.isFinite(r.rssi) && r.rssi >= f.rssiMin); }
  if(Number.isFinite(f.rssiMax)){ out = out.filter(r => Number.isFinite(r.rssi) && r.rssi <= f.rssiMax); }
  if(f.name){ const s = f.name.toLowerCase(); out = out.filter(r => (r.deviceName||'').toLowerCase().includes(s)); }

  // Category toggles
  if(f.apple){ out = out.filter(r => (r.manufacturerData && r.manufacturerData['0x004c']) || (r.category||'').toLowerCase().includes('tracker')); }
  if(f.fastpair){ 
    out = out.filter(r => (Array.isArray(r.serviceUUIDs) && r.serviceUUIDs.some(u => (u||'').toLowerCase().includes('fef3'))) || (r.category||'').toLowerCase().includes('fast pair'));
  }
  if(f.industrie){ 
    const hasFcf1 = (r) => {
      const svc = r.serviceData || {};
      const keys = Object.keys(svc).map(k=>k.toLowerCase());
      return keys.includes('0000fcf1-0000-1000-8000-00805f9b34fb') || keys.includes('fcf1');
    };
    out = out.filter(r => (r.manufacturerData && (r.manufacturerData['0x0075'])) || hasFcf1(r) || (r.category||'').toLowerCase().includes('industrie'));
  }
  return out;
}
