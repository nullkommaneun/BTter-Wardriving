// storage.js — v1.5.x kompatibel
// Primär: IndexedDB, Fallback: LocalStorage, zuletzt: RAM.
// Exportiert: init(), putRecord(rec), getAllRecords(), countLastSeconds(sec), flushNow(), _clearAll()

const DB_NAME = 'ble-scan';
const DB_VERSION = 1;
const STORE = 'records';

let idb = null;
let useLocal = false;   // true => localStorage, sonst IndexedDB; RAM ist letzter Fallback
let ram = [];           // RAM-Fallback
let openPromise = null;

// ---------- interne Helfer ----------

function openIDB() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('by_ts', 'timestamp'); // optionaler Index
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

// ---------- öffentliche API ----------

export async function init() {
  // Versuche IndexedDB; bei Fehler → LocalStorage
  try {
    await openIDB();
    useLocal = false;
  } catch (_) {
    useLocal = true;
  }
}

/**
 * Speichert einen Scan-Datensatz.
 * Erwartet ein plain object, kompatibel zu deinem Schema.
 */
export async function putRecord(rec) {
  // struktur-sicher klonen (vermeidet Proxies o. Ä.)
  const val = JSON.parse(JSON.stringify(rec));

  // IndexedDB
  if (idb && !useLocal) {
    const tx = await idbTxn('readwrite');
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).add(val);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    // Transaktion abschließen
    await new Promise((r) => { tx.oncomplete = () => r(); });
    return;
  }

  // LocalStorage-Fallback
  if (useLocal) {
    try {
      const key = 'ble-scan-records';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      arr.push(val);
      localStorage.setItem(key, JSON.stringify(arr));
      return;
    } catch (_) {
      // geht weiter zu RAM
    }
  }

  // RAM-Fallback
  ram.push(val);
}

/**
 * Liefert alle gespeicherten Datensätze (Array).
 */
export async function getAllRecords() {
  // IndexedDB
  if (idb && !useLocal) {
    const tx = await idbTxn('readonly');
    const out = await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    await new Promise((r) => { tx.oncomplete = () => r(); });
    return out;
  }

  // LocalStorage
  if (useLocal) {
    try {
      const key = 'ble-scan-records';
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (_) {
      return ram.slice();
    }
  }

  // RAM
  return ram.slice();
}

/**
 * Grobe Rateabschätzung der letzten `seconds` Sekunden (Pakete/min).
 */
export async function countLastSeconds(seconds = 60) {
  const all = await getAllRecords();
  const cutoff = Date.now() - seconds * 1000;
  let n = 0;
  for (const r of all) {
    const t = Date.parse(r.timestamp);
    if (!Number.isNaN(t) && t >= cutoff) n++;
  }
  return Math.round(n * (60 / seconds));
}

/**
 * Platzhalter für Kompatibilität (z. B. Batch-Flush).
 */
export async function flushNow() {
  return; // bewusst leer
}

/**
 * Optional: löscht alle gespeicherten Datensätze (für Tests).
 */
export async function _clearAll() {
  if (idb && !useLocal) {
    const tx = await idbTxn('readwrite');
    await new Promise((resolve, reject) => {
      const req = tx.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await new Promise((r) => { tx.oncomplete = () => r(); });
    return;
  }
  if (useLocal) {
    localStorage.removeItem('ble-scan-records');
  }
  ram = [];
}
