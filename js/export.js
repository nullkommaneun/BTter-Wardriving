function download(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}

export function exportJSON(rows){
  const ts = new Date().toISOString().replaceAll(':','-');
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type:'application/json' });
  download(`ble-scan_${ts}.json`, blob);
}

export function exportCSV(rows, prefix='ble-scan'){
  const header = ['timestamp','deviceName','serviceUUIDs','rssi','latitude','longitude','sessionId','category','vendor','icon','count'];
  const lines = [header.join(',')];
  for(const r of rows){
    const uu = (r.serviceUUIDs||[]).join(';');
    const vals = [r.timestamp, r.deviceName||'', uu, r.rssi??'', r.latitude??'', r.longitude??'', r.sessionId||'', r.category||'', r.vendor||'', r.icon||'', r.count??''];
    lines.push(vals.map(v => String(v).replaceAll('"','""')).map(v=>`"${v}"`).join(','));
  }
  const ts = new Date().toISOString().replaceAll(':','-');
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  download(`${prefix}_${ts}.csv`, blob);
}
