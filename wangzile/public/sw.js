// 骏宇超市 Service Worker - 简单离线缓存
const CACHE_NAME = 'junyu-chaoshi-v3';
const PRECACHE = ['/', '/css/style.css', '/js/app.js', '/admin.html', '/js/admin.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 只处理同源 GET 请求
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  // API 与上传图片不走缓存
  if (req.url.includes('/api/') || req.url.includes('/uploads/')) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
