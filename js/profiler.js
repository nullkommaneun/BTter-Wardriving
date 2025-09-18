const rules = [
  { test:/jbl/i, category:'Audio', vendor:'JBL', icon:'🎵' },
  { test:/sierzega/i, category:'Verkehr', vendor:'Sierzega', icon:'🚦' },
  { test:/dtco|tachograph/i, category:'Fahrzeug', vendor:'DTCO', icon:'🚛' },
  { test:/garmin/i, category:'Wearable', vendor:'Garmin', icon:'⌚' },
  { test:/mi|xiaomi/i, category:'Elektronik', vendor:'Xiaomi', icon:'📱' },
  { test:/bosch/i, category:'Industrie', vendor:'Bosch', icon:'🏭' },
  { test:/vw|volkswagen/i, category:'Fahrzeug', vendor:'Volkswagen', icon:'🚗' },
];

export function profileDevice(name, uuids){
  if(!name){ return { category:'', vendor:'', icon:'' }; }
  for(const r of rules){ if(r.test.test(name)) return { category:r.category, vendor:r.vendor, icon:r.icon }; }
  return { category:'', vendor:'', icon:'' };
}
