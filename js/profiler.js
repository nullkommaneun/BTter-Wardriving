const rules = [
  { test:/rockster|teufel/i, category:'Audio', vendor:'Teufel', icon:'🎵' },
  { test:/jbl/i, category:'Audio', vendor:'JBL', icon:'🎵' },
  { test:/sony|srs-|wh-|wf-/i, category:'Audio', vendor:'Sony', icon:'🎧' },
  { test:/bose/i, category:'Audio', vendor:'Bose', icon:'🎵' },
  { test:/marshall/i, category:'Audio', vendor:'Marshall', icon:'🎸' },
  { test:/hp\s*officejet|hp\s*laser|hp-/i, category:'Drucker', vendor:'HP', icon:'🖨️' },
  { test:/epson/i, category:'Drucker', vendor:'Epson', icon:'🖨️' },
  { test:/brother/i, category:'Drucker', vendor:'Brother', icon:'🖨️' },
  { test:/canon/i, category:'Drucker', vendor:'Canon', icon:'🖨️' },
  { test:/garmin/i, category:'Wearable', vendor:'Garmin', icon:'⌚' },
  { test:/fitbit/i, category:'Wearable', vendor:'Fitbit', icon:'⌚' },
  { test:/polar/i, category:'Wearable', vendor:'Polar', icon:'⌚' },
  { test:/tile/i, category:'Tracker', vendor:'Tile', icon:'🧩' },
  { test:/airtag|apple/i, category:'Tracker', vendor:'Apple', icon:'🧭' },
  { test:/sierzega|radar|speed|verkehr/i, category:'Verkehr', vendor:'Sierzega/Radar', icon:'🚦' },
  { test:/dtco|tachograph|vdo/i, category:'Tachograph', vendor:'DTCO/VDO', icon:'🚛' },
  { test:/vw|volkswagen/i, category:'Fahrzeug', vendor:'Volkswagen', icon:'🚗' },
  { test:/bmw/i, category:'Fahrzeug', vendor:'BMW', icon:'🚗' },
  { test:/audi/i, category:'Fahrzeug', vendor:'Audi', icon:'🚗' },
  { test:/bosch|siemens|phoenix/i, category:'Industrie', vendor:'Industrie', icon:'🏭' },
  { test:/xiaomi|redmi|mi\s/i, category:'Elektronik', vendor:'Xiaomi', icon:'📱' },
  { test:/huawei|honor/i, category:'Elektronik', vendor:'Huawei/Honor', icon:'📱' },
  { test:/samsung|galaxy/i, category:'Elektronik', vendor:'Samsung', icon:'📱' },
];

export function profileDevice(name, uuids){
  if(!name){ return { category:'', vendor:'', icon:'' }; }
  for(const r of rules){ if(r.test.test(name)) return { category:r.category, vendor:r.vendor, icon:r.icon }; }
  return { category:'', vendor:'', icon:'' };
}

// Fallback by decoded beacon/manufacturer
export function fallbackProfileByDecoded(record){
  if(record.beaconType === 'iBeacon'){
    return { category: record.category || 'Tracker', vendor: record.vendor || 'Apple/Beacon', icon: record.icon || '🧭' };
  }
  if(record.beaconType === 'Eddystone-URL' || record.beaconType === 'Eddystone-TLM'){
    return { category: record.category || 'Beacon', vendor: record.vendor || 'Eddystone', icon: record.icon || '🔗' };
  }
  const mfg = record.manufacturerData || {};
  // Service UUIDs
  if(Array.isArray(record.serviceUUIDs)){
    const hasFEF3 = record.serviceUUIDs.some(u => (u||'').toLowerCase().includes('fef3'));
    if(hasFEF3){
      return { category: record.category || 'Fast Pair', vendor: record.vendor || 'Google', icon: record.icon || '🎧' };
    }
  }
  // Known proprietary (example): 0xFCF1 in serviceData
  const svc = record.serviceData || {};
  const keys = Object.keys(svc).map(k=>k.toLowerCase());
  if(keys.includes('0000fcf1-0000-1000-8000-00805f9b34fb') || keys.includes('fcf1')){
    return { category: record.category || 'Beacon', vendor: record.vendor || '', icon: record.icon || '📡' };
  }

  if(mfg['0x004c']){ return { category: record.category || 'Tracker', vendor: record.vendor || 'Apple', icon: record.icon || '🧭' }; }
  return { category: record.category || '', vendor: record.vendor || '', icon: record.icon || '📡' };
}
