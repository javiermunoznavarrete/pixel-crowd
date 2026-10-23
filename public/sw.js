// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Service worker de la web del público: guarda en el teléfono la página, el motor, el mapa del
// recinto y los datos del evento. Quien abre el link antes del concierto (en casa, con buena señal)
// puede volver a abrirlo en el recinto aunque la red esté saturada.
//
// - En la primera visita la página le pide guardar lo que ya bajó (mensaje "guardar"): página, mapa y evento.
// - Mapa del recinto y fuentes: primero lo guardado (no cambian) y se actualiza en segundo plano.
// - Página, scripts y evento: primero la red, para que una actualización llegue apenas hay señal; si en 4 s no
//   responde, lo guardado; y si no hay nada guardado, se sigue esperando a la red en vez de fallar.
// El estado en vivo (/events, /estado), el reloj y el panel nunca se guardan.
const VERSION = 'pc-v2';
const BASICOS = ['/show.js', '/portada.js', '/analitica.js', '/vendor/NoSleep.min.js'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (e) => {
  // Con "no-cache" + ETag, lo que la página ya bajó se revalida con un 304 vacío, sin volver a descargarlo
  e.waitUntil(caches.open(VERSION).then((c) => guardarVarios(c, BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cada archivo por separado: si uno falla (mala señal), los demás igual quedan guardados
function guardarVarios(cache, urls) {
  return Promise.allSettled(urls.map((u) => cache.add(u)));
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'guardar' && Array.isArray(e.data.urls)) {
    const urls = e.data.urls.filter((u) => typeof u === 'string' && u.startsWith('/') && guardable(new URL(u, self.location.origin)));
    e.waitUntil(caches.open(VERSION).then((c) => guardarVarios(c, urls)));
  }
});

// Qué se guarda: páginas del público, archivos propios y los datos fijos de cada evento
function guardable(url) {
  if (url.origin !== self.location.origin) return /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const p = url.pathname;
  if (p.startsWith('/api/')) return /^\/api\/e\/[a-z0-9-]+\/(evento|recinto)$/.test(p) || p === '/api/eventos';
  if (/\/(operador|simulador|conectar|admin)$/.test(p)) return false;
  return true;
}

const guardarRespuesta = (cache, req, res) => {
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
};

async function redPrimero(req) {
  const cache = await caches.open(VERSION);
  const red = fetch(req).then((res) => guardarRespuesta(cache, req, res));
  const plazo = new Promise((listo) => setTimeout(() => listo('plazo'), ESPERA_RED_MS));
  const primero = await Promise.race([red.catch(() => 'error'), plazo]);
  if (primero !== 'plazo' && primero !== 'error') return primero;
  const guardada = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
  return guardada || red; // sin copia guardada: se sigue esperando a la red (o su error)
}

async function guardadoPrimero(e) {
  const cache = await caches.open(VERSION);
  const guardada = await cache.match(e.request, { ignoreVary: true });
  const red = fetch(e.request).then((res) => guardarRespuesta(cache, e.request, res));
  if (guardada) { e.waitUntil(red.catch(() => {})); return guardada; }
  return red;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (!guardable(url)) return;
  const fijo = url.origin !== self.location.origin || /\/recinto$/.test(url.pathname);
  e.respondWith(fijo ? guardadoPrimero(e) : redPrimero(e.request));
});
