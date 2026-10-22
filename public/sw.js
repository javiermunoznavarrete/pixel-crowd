// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Service worker de la web del público: guarda en el teléfono la página, el motor, el mapa del
// recinto y los datos del evento. Quien abre el link antes del concierto (en casa, con buena señal)
// puede volver a abrirlo en el recinto aunque la red esté saturada.
//
// Estrategia: primero la red (con un límite de espera) y, si no responde, lo guardado. Así una
// actualización publicada llega apenas hay señal, y sin señal la app abre igual.
// El estado en vivo (/events, /estado), el reloj y el panel nunca se guardan.
const VERSION = 'pc-v1';
const BASICOS = ['/show.js', '/portada.js', '/vendor/NoSleep.min.js'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Qué se guarda: páginas del público, archivos propios y los datos fijos de cada evento
function guardable(url) {
  if (url.origin !== self.location.origin) return /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const p = url.pathname;
  if (p.startsWith('/api/')) return /^\/api\/e\/[a-z0-9-]+\/(evento|recinto)$/.test(p) || p === '/api/eventos';
  if (/\/(operador|simulador|conectar)$/.test(p)) return false;
  return true;
}

async function redPrimero(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('sin respuesta')), ESPERA_RED_MS)),
    ]);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (e) {
    const guardada = await cache.match(req, { ignoreVary: true });
    if (guardada) return guardada;
    throw e;
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (!guardable(url)) return;
  e.respondWith(redPrimero(e.request));
});
