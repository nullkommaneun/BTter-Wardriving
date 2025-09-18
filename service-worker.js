const CACHE = 'ble-scan-v1.4.3';
const ASSETS = [
  './', './index.html', './styles.css',
  './js/main.js','./js/ble.js','./js/geo.js','./js/storage.js','./js/map.js','./js/filters.js','./js/export.js','./js/cluster.js','./js/profiler.js','./js/session.js','./js/parse.js',
  './manifest.json'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(url.origin === location.origin){
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
  }
});
