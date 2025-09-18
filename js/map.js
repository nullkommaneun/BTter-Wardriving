let map, markersLayer;
let initialized = false;

export async function init(){
  if(initialized && map){ return; }
  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  map.setView([50.71, 12.49], 12);
  initialized = true;
}

export function update(rows){
  try{ window.__lastRows = rows; }catch{}
  if(!map) return;
  markersLayer.clearLayers();
  for(const r of rows){
    if(typeof r.latitude === 'number' && typeof r.longitude === 'number'){
      const m = L.marker([r.latitude, r.longitude]);
      const name = (r.icon||'') + ' ' + (r.deviceName||'');
      const uu = (r.serviceUUIDs||[]).join(';');
      const cnt = r.count ?? '';
      const idx = rows.indexOf(r);
      const html = `<b>${name}</b><br/>${new Date(r.timestamp).toLocaleString()}<br/>RSSI: ${r.rssi} txP:${r.txPower ?? ''} d≈${r.distanceM ?? ''}m<br/>UUIDs: ${uu}<br/>Count(5s): ${cnt}<br/><button onclick=\"window.__showRaw(${idx})\">Rohdaten</button>`;
      m.bindPopup(html);
      markersLayer.addLayer(m);
    }
  }
}

export function fitToData(){
  const bounds = [];
  markersLayer.eachLayer(l=>{
    const ll = l.getLatLng();
    bounds.push([ll.lat, ll.lng]);
  });
  if(bounds.length){ map.fitBounds(bounds, { padding:[20,20] }); }
}
