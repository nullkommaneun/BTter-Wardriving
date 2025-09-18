let current = null;
let counter = 0;
let lastEventTs = 0;
const INACTIVITY_MS = 180_000;

export function init(){
  rollIfNeeded(true);
}

function makeId(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}${m}${day}-${counter}`;
}

function rollIfNeeded(force=false){
  const now = Date.now();
  const dayStr = new Date().toISOString().slice(0,10);
  const curDay = current?.slice(0,10).replaceAll('-','');
  if(force || !current || dayStr.replaceAll('-','') !== curDay){
    counter = 1; current = makeId(); lastEventTs = now; return;
  }
  if((now - lastEventTs) > INACTIVITY_MS){ counter++; current = makeId(); lastEventTs = now; }
}

export function tick(){ rollIfNeeded(false); }
export function noteEvent(){ lastEventTs = Date.now(); }
export function currentSessionId(){ rollIfNeeded(false); return current; }
