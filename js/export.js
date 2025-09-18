function download(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}

function toCSV(rows, prefix){
  const header = [
    'timestamp','deviceName','serviceUUIDs','rssi','txPower','latitude','longitude','sessionId','category','vendor','icon','count',
    // raw fields
    'manufacturerData','serviceData',
    // decoded (optional)
    'beaconType','beaconUUID','beaconMajor','beaconMinor','beaconTxPower','eddystoneURL','eddystoneTx','eddystoneVersion','eddystoneVBatt_mV','eddystoneTemp_C','eddystoneAdvCount','eddystoneSecCount'

  ];
  const lines = [header.join(',').trimEnd()];
  for(const r of rows){
    const uu = (r.serviceUUIDs||[]).join(';');
    const mfg = r.manufacturerData ? JSON.stringify(r.manufacturerData) : '';
    const svc = r.serviceData ? JSON.stringify(r.serviceData) : '';
    const vals = [
      r.timestamp, r.deviceName||'', uu, r.rssi??'', r.txPower??'', r.latitude??'', r.longitude??'', r.sessionId||'', r.category||'', r.vendor||'', r.icon||'', r.count??'',
      mfg, svc,
      r.beaconType||'', r.beaconUUID||'', r.beaconMajor??'', r.beaconMinor??'', r.beaconTxPower??'', r.eddystoneURL||'', r.eddystoneTx??'', r.eddystoneVersion??'', r.eddystoneVBatt_mV??'', r.eddystoneTemp_C??'', r.eddystoneAdvCount??'', r.eddystoneSecCount??''
    ];
    lines.push(vals.map(v => String(v).replaceAll('"','""')).map(v=>`"${v}"`).join(','));
  }
  const ts = new Date().toISOString().replaceAll(':','-');
  const blob = new Blob([lines.join('\n')], { type:'text/csv' });
  download(`${prefix}_${ts}.csv`, blob);
}

export function exportJSON(rows){
  const ts = new Date().toISOString().replaceAll(':','-');
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type:'application/json' });
  download(`ble-scan_${ts}.json`, blob);
}

export function exportCSV(rows, prefix='ble-scan'){
  toCSV(rows, prefix);
}
