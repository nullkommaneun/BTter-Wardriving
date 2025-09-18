let desired = 'normal';
let watcher = null;
let lastPosition = null;

export async function init(){
  if(!navigator.geolocation) return;
  setRate('normal');
}

export function setRate(mode){
  desired = mode;
  if(!navigator.geolocation) return;
  if(watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
  const fast = (desired === 'fast');
  watcher = navigator.geolocation.watchPosition(
    pos => { lastPosition = pos; },
    err => { /* allow null */ },
    { enableHighAccuracy: !fast, maximumAge: fast? 1000 : 5000, timeout: fast? 2000 : 8000 }
  );
}

export async function sample(){
  return lastPosition;
}
