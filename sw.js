// sw.js — Service Worker для офлайн-работы Pan-Tilt AI Tracker
const CACHE_NAME = 'ai-tracker-v1.2';
const OFFLINE_PAGE = '/offline.html';

// Ресурсы для немедленного кэширования при установке
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Библиотеки с unpkg (надёжный CDN)
  'https://unpkg.com/@tensorflow/tfjs@4.10.0/dist/tf.min.js',
  'https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  'https://unpkg.com/paho-mqtt@1.1.0/mqtt.min.js'
];

// Паттерны URL для кэширования модели
const MODEL_PATTERNS = [
  'coco-ssd',
  'tensorflow/tfjs',
  'lite_mobilenet_v2'
];

// Установка: кэшируем статику
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кэширование статики...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Ошибка кэширования:', err))
  );
});

// Активация: очистка старых кэшей
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Удаление старого кэша:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия запросов: Cache First для модели, Network First для остального
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 🔹 Модель и библиотеки: Cache First, затем Network
  if (MODEL_PATTERNS.some(pattern => url.href.includes(pattern))) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          console.log('[SW] 📦 Из кэша:', url.pathname);
          return cached;
        }
        console.log('[SW] 🌐 Загрузка из сети:', url.pathname);
        return fetch(request).then((response) => {
          // Кэшируем успешные ответы
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          console.warn('[SW] ⚠️ Не удалось загрузить:', url.pathname);
          // Возвращаем заглушку для JSON-запросов модели
          if (request.destination === 'script' || url.pathname.endsWith('.json')) {
            return new Response('{"error":"offline"}', { 
              headers: { 'Content-Type': 'application/json' } 
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // 🔹 MQTT и API: Network First (всегда живое соединение)
  if (url.href.includes('mqtt') || url.href.includes('hivemq')) {
    event.respondWith(
      fetch(request).catch(() => {
        console.warn('[SW] ⚠️ MQTT недоступен офлайн');
        return new Response('{"offline":true}', { 
          headers: { 'Content-Type': 'application/json' } 
        });
      })
    );
    return;
  }

  // 🔹 Остальное: Stale-While-Revalidate (быстро из кэша, обновляем в фоне)
  event.respondWith(
    caches.match(request).then((cached) => {
      const networked = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      
      return cached || networked;
    })
  );
});

// Сообщения от основной страницы
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    caches.keys().then((names) => {
      Promise.all(names.map(name => caches.open(name).then(c => c.keys())))
        .then((requests) => {
          const urls = requests.flat().map(r => r.url);
          event.ports[0]?.postMessage({ cached: urls, count: urls.length });
        });
    });
  }
});
