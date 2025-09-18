// BLE Advertisement decoders and helpers

function bufToHex(buf){
  if(!buf) return '';
  const arr = new Uint8Array(buf.buffer || buf);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function mfgToObject(manufacturerData){
  const out = {};
  if(!manufacturerData) return out;
  manufacturerData.forEach((value, key)=>{
    // key is 16-bit company identifier
    out['0x'+key.toString(16).padStart(4,'0')] = bufToHex(value);
  });
  return out;
}

export function svcToObject(serviceData){
  const out = {};
  if(!serviceData) return out;
  serviceData.forEach((value, key)=>{
    // key is UUID string
    out[key] = bufToHex(value);
  });
  return out;
}

// iBeacon decoder (Apple Company ID 0x004C)
function decodeIBeacon(mfg){
  const apple = mfg['0x004c'];
  if(!apple) return null;
  // iBeacon prefix: 0x02 0x15 then 16B UUID + 2B Major + 2B Minor + 1B TxPower
  // apple payload layout varies; we search for 0215
  const idx = apple.indexOf('0215');
  if(idx === -1) return null;
  const hex = apple.slice(idx);
  if(hex.length < 2* (1+1+16+2+2+1)) return null;
  const uuid = hex.slice(4, 4+32);
  const major = parseInt(hex.slice(36, 40), 16);
  const minor = parseInt(hex.slice(40, 44), 16);
  const tx = parseInt(hex.slice(44, 46), 16);
  const uuidFmt = `${uuid.slice(0,8)}-${uuid.slice(8,12)}-${uuid.slice(12,16)}-${uuid.slice(16,20)}-${uuid.slice(20)}`;
  return { beaconType:'iBeacon', beaconUUID: uuidFmt, beaconMajor: major, beaconMinor: minor, beaconTxPower: (tx>127? tx-256: tx) };
}

// Eddystone decoders (URL / TLM) – from service UUID 0xFEAA
function decodeEddystone(service){
  const feaa = service['feaa'] || service['FEAA'];
  if(!feaa) return null;
  // frame type is first byte: 0x10 URL, 0x20 TLM
  const frameType = feaa.slice(0,2);
  if(frameType === '10'){
    // URL frame: 10 | tx | urlScheme | url
    const schemeCodes = ['http://www.','https://www.','http://','https://'];
    const enc = [
      '.com/', '.org/', '.edu/', '.net/', '.info/', '.biz/', '.gov/', '.com', '.org', '.edu', '.net', '.info', '.biz', '.gov'
    ];
    const tx = parseInt(feaa.slice(2,4),16);
    const scheme = schemeCodes[parseInt(feaa.slice(4,6),16)] || '';
    let url = scheme;
    // decode rest with expansion table
    let i = 6;
    while(i < feaa.length){
      const byte = parseInt(feaa.slice(i,i+2),16);
      if(byte <= 13){ url += enc[byte]; }
      else { url += String.fromCharCode(byte); }
      i += 2;
    }
    return { beaconType:'Eddystone-URL', eddystoneTx: (tx>127? tx-256: tx), eddystoneURL: url };
  }else if(frameType === '20'){
    // TLM: battery/temp/uptime (simplified, version agnostic)
    // 20 | version | vbatt[2] | temp[2] | advCnt[4] | secCnt[4]
    if(feaa.length >= 2*14){
      const version = parseInt(feaa.slice(2,4),16);
      const vbatt = parseInt(feaa.slice(4,8),16); // mV
      const tempRaw = parseInt(feaa.slice(8,12),16);
      const temp = (tempRaw>0x7fff? tempRaw-0x10000: tempRaw)/256.0;
      const advCnt = parseInt(feaa.slice(12,20),16);
      const secCnt = parseInt(feaa.slice(20,28),16);
      return { beaconType:'Eddystone-TLM', eddystoneVersion: version, eddystoneVBatt_mV: vbatt, eddystoneTemp_C: temp, eddystoneAdvCount: advCnt, eddystoneSecCount: secCnt };
    }
  }
  return null;
}

export function decode(manufacturerData, serviceData){
  const mfg = mfgToObject(manufacturerData);
  const svc = svcToObject(serviceData);
  const out = {};
  const ib = decodeIBeacon(mfg);
  if(ib) Object.assign(out, ib);
  const ed = decodeEddystone(svc);
  if(ed) Object.assign(out, ed);
  return out;
}
