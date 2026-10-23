// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Seguridad del servidor tal como corre en producción: detrás de Cloudflare, con ORIGEN_SECRETO activado.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const SECRETO = 'secreto-de-origen-de-prueba';
let proc;

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT, CLAVE_ADMIN: 'clave-larga-de-prueba', ORIGEN_SECRETO: SECRETO, MAX_CONEXIONES_POR_IP: '3',
      EVENTOS_DIR: path.join(__dirname, 'fixtures', 'eventos'), RECINTOS_DIR: path.join(__dirname, '..', 'data', 'recintos'),
      DATA_APORTES: fs.mkdtempSync(path.join(os.tmpdir(), 'pc-seg-ap-')), DATA_ESTADISTICAS: fs.mkdtempSync(path.join(os.tmpdir(), 'pc-seg-est-')),
    },
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('Ctrl+C') && resolve());
    proc.on('exit', (c) => reject(new Error('el servidor terminó con código ' + c)));
  });
});
test.after(() => proc.kill());

// Pedido como lo reenvía Cloudflare: con la cabecera secreta y la IP del visitante
const viaCloudflare = (ip, extra = {}) => ({ 'x-pixel-origen': SECRETO, 'cf-connecting-ip': ip, ...extra });
const login = (clave, ip) => fetch(BASE + '/api/login', {
  method: 'POST', headers: viaCloudflare(ip, { 'Content-Type': 'application/json' }), body: JSON.stringify({ clave }),
});

test('sin la cabecera secreta de Cloudflare no se atiende nada (no se puede saltar Cloudflare)', async () => {
  for (const ruta of ['/', '/api/time', '/admin', '/api/e/prueba-a/estado']) {
    assert.strictEqual((await fetch(BASE + ruta)).status, 403, ruta);
    assert.strictEqual((await fetch(BASE + ruta, { headers: { 'x-pixel-origen': 'otra-cosa' } })).status, 403, ruta);
  }
  assert.strictEqual((await fetch(BASE + '/api/time', { headers: viaCloudflare('1.1.1.1') })).status, 200);
});

test('login: un intruso que falla la clave queda bloqueado sin bloquear al operador', async () => {
  for (let i = 0; i < 5; i++) assert.strictEqual((await login('mala', '6.6.6.6')).status, 401);
  const bloqueado = await login('clave-larga-de-prueba', '6.6.6.6');
  assert.strictEqual(bloqueado.status, 429, 'el intruso queda bloqueado aunque acierte');
  // El operador, desde otra IP, entra igual
  const op = await login('clave-larga-de-prueba', '200.1.2.3');
  assert.strictEqual(op.status, 200);
  assert.strictEqual((await op.json()).alcance, '*');
});

test('login: cada clave incorrecta demora la respuesta (fuerza bruta lenta)', async () => {
  const t0 = Date.now();
  await login('otra-mala', '7.7.7.7');
  assert.ok(Date.now() - t0 >= 350, `tardó ${Date.now() - t0} ms`);
});

test('tope de conexiones en vivo por IP, sin afectar a otras IP', async () => {
  const abrir = (ip) => new Promise((resolve) => {
    const req = http.get(`${BASE}/api/e/prueba-a/events?rol=publico&zona=G1`, { headers: viaCloudflare(ip) }, (res) => resolve({ status: res.statusCode, cerrar: () => req.destroy() }));
  });
  const abiertas = [await abrir('9.9.9.9'), await abrir('9.9.9.9'), await abrir('9.9.9.9')];
  assert.deepStrictEqual(abiertas.map((c) => c.status), [200, 200, 200]);
  const cuarta = await abrir('9.9.9.9');
  assert.strictEqual(cuarta.status, 429);
  const otra = await abrir('9.9.9.10');
  assert.strictEqual(otra.status, 200);
  [...abiertas, cuarta, otra].forEach((c) => c.cerrar());
});

test('cabeceras de seguridad y política de contenido con la huella de cada script de la página', async () => {
  const r = await fetch(BASE + '/prueba-a', { headers: viaCloudflare('1.1.1.1') });
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("frame-ancestors 'self'") && csp.includes("object-src 'none'"));
  // Cada script escrito en el HTML está autorizado por su huella (con saltos de línea normalizados como el navegador)
  const html = await r.text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  for (const [, codigo] of scripts) {
    const h = crypto.createHash('sha256').update(codigo.replace(/\r\n?/g, '\n')).digest('base64');
    assert.ok(csp.includes(`'sha256-${h}'`), 'falta la huella de un script');
  }
});

test('emergencia: con la clave general se cierran todas las demás sesiones', async () => {
  const otra = (await (await login('clave-larga-de-prueba', '200.1.2.4')).json()).sesion;
  const mia = (await (await login('clave-larga-de-prueba', '200.1.2.5')).json()).sesion;
  const valida = async (s) => (await (await fetch(BASE + '/api/sesion', { headers: viaCloudflare('200.1.2.5', { 'x-sesion': s }) })).json()).valida;
  assert.strictEqual(await valida(otra), true);
  const r = await fetch(BASE + '/api/sesiones/cerrar-otras', { method: 'POST', headers: viaCloudflare('200.1.2.5', { 'x-sesion': mia }) });
  assert.strictEqual(r.status, 200);
  assert.ok((await r.json()).cerradas >= 1);
  assert.strictEqual(await valida(otra), false, 'la otra sesión quedó cerrada');
  assert.strictEqual(await valida(mia), true, 'la propia sigue');
  // Sin sesión no se puede
  assert.strictEqual((await fetch(BASE + '/api/sesiones/cerrar-otras', { method: 'POST', headers: viaCloudflare('5.5.5.5') })).status, 401);
});
