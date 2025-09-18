const DB_NAME = 'ble-scan-db';
const DB_VERSION = 2; // bump for new fields
let db = null;
let fallback = [];

export async function init(){
  if(!('indexedDB' in window)) return; 
  db = await open();
}

function open(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
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

export async function addRecord(rec){
  if(!db){ fallback.push(rec); return; }
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('records','readwrite');
    tx.onabort = ()=> reject(tx.error);
    tx.onerror = ()=> reject(tx.error);
    tx.oncomplete = ()=> resolve();
    tx.objectStore('records').add(rec);
  });
}

export async function getAllRecords(){
  if(!db) return [...fallback];
  return new Promise((resolve,reject)=>{
    const tx = db.transaction('records','readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}
