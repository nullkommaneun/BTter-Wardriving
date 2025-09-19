// main.diag.js – reines Single-File-Diag, keine Importe
const probe = document.getElementById('jsProbe');
if (probe) probe.textContent = 'JS-Modul geladen (Diag)';
const statusEl = document.getElementById('status');
const pfEl = document.getElementById('preflightStatus');

function setStatus(t){ if(statusEl) statusEl.textContent = t; if(pfEl) pfEl.textContent = t; }

window.addEventListener('error', e => setStatus('Fehler: ' + (e.message || 'Uncaught')));
window.addEventListener('unhandledrejection', e => setStatus('Fehler: ' + (e.reason?.message || 'Promise')));

async function preflight(){
  const okBLE  = !!(navigator.bluetooth && navigator.bluetooth.requestLEScan);
  const okGeo  = !!navigator.geolocation;
  const okWake = !!(navigator.wakeLock && navigator.wakeLock.request);
  const msg = `Preflight: requestLEScan:${okBLE?'OK':'NEIN'} | Geolocation:${okGeo?'OK':'NEIN'} | WakeLock:${okWake?'OK':'NEIN'}`;
  setStatus(msg);
  return okBLE;
}

document.getElementById('btnPreflight')?.addEventListener('click', preflight);
document.addEventListener('DOMContentLoaded', preflight);
