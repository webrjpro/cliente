// CrediGestor Portal — Service Worker
// Cache-first para arquivos estáticos (HTML/CSS/JS), network-first para Supabase.
// Bumpe CACHE_VERSION quando publicar mudanças importantes para invalidar cache antigo.

const CACHE_VERSION = 'credigestor-portal-v8';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/portal.css',
  './js/config.js',
  './js/auth.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass total para qualquer chamada ao Supabase / CDN externos
  // (sempre rede, nunca cache — dados mudam o tempo todo)
  if (url.host.includes('supabase.co') || url.host.includes('cdn.jsdelivr.net') || url.host.includes('googleapis.com')) {
    return; // deixa o browser tratar normalmente
  }

  // Só intercepta GET dos próprios assets do portal
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Atualiza em background (stale-while-revalidate)
        fetch(event.request).then((fresh) => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, fresh.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((fresh) => {
        if (fresh && fresh.status === 200 && fresh.type === 'basic') {
          const clone = fresh.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return fresh;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// Receber mensagens do client (ex: "skipWaiting" para forçar update)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
