const DB_NAME = 'ble-scan-db';
const DB_VERSION = 3;
let db = null;
let fallback = [];

let q = [];
let flushTimer = null;
function scheduleFlush(){
  if(flushTimer) return;
  flushTimer = setTimeout(async ()=>{
    const items = q; q = []; flushTimer = null;
    if(!db){ fallback.push(...items); return; }
    try{
      const tx = db.transaction('records','readwrite');
      const store = tx.objectStore('records');
      for(const r of items){ store.add(r); }
    }catch(e){ console.warn('batch write failed', e); }
  }, 250);
}


export async function init(){
  if(!('indexedDB' in window)) return; 
  db = await open();
}

function open(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains('records')){
        const store = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_time','timestamp');
      }
      if(!db.objectStoreNames.contains('meta')){
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

export async function addRecord(rec){ q.push(rec); scheduleFlush(); }

export async function getAllRecords(){
  if(!db) return [...fallback];
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('records','readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}
