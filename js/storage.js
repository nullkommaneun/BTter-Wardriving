
// storage.js — v1.5.x kompatibel
// IndexedDB primär, Fallback LocalStorage, letzter Ausweg: RAM.

const DB_NAME = 'ble-scan';
const DB_VERSION = 1;
const STORE = 'records';

let idb = null;
let useLocal = false;
let ram = [];
let openPromise = null;

function openIDB() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('by_ts', 'timestamp');
        }
      };
      req.onsuccess = () => { idb = req.result; resolve(idb); };
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return openPromise;
}

async function idbTxn(mode = 'readonly') {
  const db = await openIDB();
  return db.transaction(STORE, mode);
}

export async function init() {
  try { await openIDB(); useLocal = false; }
  catch (_) { useLocal = true; }
}

export async function putRecord(rec) {
  const val = JSON.parse(JSON.stringify(rec));
  if (idb && !useLocal) {
    const tx = await idbTxn('readwrite');
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).add(val);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await new Promise(r => { tx.oncomplete = () => r(); });
    return;
  }
  if (useLocal) {
    try {
      const key = 'ble-scan-records';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.push(val);
      localStorage.setItem(key, JSON.stringify(arr));
      return;
    } catch (_) {}
  }
  ram.push(val);
}

export async function getAllRecords() {
  if (idb && !useLocal) {
    const tx = await idbTxn('readonly');
    const store = tx.objectStore(STORE);
    const out = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    await new Promise(r => { tx.oncomplete = () => r(); });
    return out;
  }
  if (useLocal) {
    try {
      const key = 'ble-scan-records';
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_) { return ram.slice(); }
  }
  return ram.slice();
}

export async function countLastSeconds(seconds = 60) {
  const all = await getAllRecords();
  const cutoff = Date.now() - seconds * 1000;
  let n = 0;
  for (const r of all) {
    const t = Date.parse(r.timestamp);
    if (!Number.isNa
