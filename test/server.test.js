// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const fs = require('fs');
const os = require('os');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DIR_APORTES = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-aportes-'));
const BASE = `http://localhost:${PORT}`;
let proc;

// Eventos de prueba (test/fixtures/eventos): prueba-a y prueba-b usan el recinto demo; prueba-b tiene
// clave propia; prueba-vieja es pasada y oculta.
test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT, CLAVE_ADMIN: 'secreto', CLAVE_EVENTO_PRUEBA_B: 'clave-b', URL_PUBLICO: 'https://ejemplo.cl',
      EVENTOS_DIR: path.join(__dirname, 'fixtures', 'eventos'),
      RECINTOS_DIR: path.join(__dirname, '..', 'data', 'recintos'),
      DATA_APORTES: DIR_APORTES,
    },
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('Ctrl+C') && resolve());
    proc.on('exit', (c) => reject(new Error('el servidor terminó con código ' + c)));
  });
  // Sesión con la clave general para los tests que la necesitan (login está definido más abajo)
  SESION = (await (await login('secreto')).json()).sesion;
});
test.after(() => proc.kill());

const login = (clave, evento) => fetch(BASE + '/api/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave, evento }),
});
let SESION = '';

const escena = (cuerpo, sesion = SESION, ev = 'prueba-a') => fetch(`${BASE}/api/e/${ev}/escena`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sesion': sesion }, body: JSON.stringify(cuerpo),
});
const estadoDe = async (ev) => (await fetch(`${BASE}/api/e/${ev}/estado`)).json();

// Abre un stream SSE y devuelve los eventos recibidos a medida que llegan.
function abrirSSE(query, ev = 'prueba-a') {
  const eventos = [];
  const req = http.get(`${BASE}/api/e/${ev}/events?${query}`, (res) => {
    let buf = '';
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        const evento = /^event: (.+)$/m.exec(bloque), data = /^data: (.+)$/m.exec(bloque);
        if (evento && data) eventos.push({ evento: evento[1], datos: JSON.parse(data[1]) });
      }
    });
  });
  return { eventos, cerrar: () => req.destroy() };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('sirve la lista de eventos, las páginas de cada evento y su recinto', async () => {
  for (const p of ['/', '/prueba-a', '/prueba-a/operador', '/prueba-a/simulador', '/prueba-a/conectar', '/show.js']) {
    assert.strictEqual((await fetch(BASE + p)).status, 200, p);
  }
  const recinto = await (await fetch(BASE + '/api/e/prueba-a/recinto')).json();
  assert.strictEqual(recinto.sectores.find((s) => s.id === 'G1').asientos.length, 12 * 85);
});

test('la lista pública muestra los eventos visibles ordenados por fecha, sin los ocultos', async () => {
  const lista = await (await fetch(BASE + '/api/eventos')).json();
  assert.deepStrictEqual(lista.map((e) => e.slug), ['prueba-a', 'prueba-b']);
  assert.strictEqual(lista[0].situacion, 'proximo');
  assert.strictEqual(lista[1].requiereClave, true);
  const vieja = await (await fetch(BASE + '/api/e/prueba-vieja/evento')).json();
  assert.strictEqual(vieja.situacion, 'terminado'); // oculto de la lista, pero su página sigue existiendo
});

test('el evento entrega sus presets y no expone claves', async () => {
  const ev = await (await fetch(BASE + '/api/e/prueba-a/evento')).json();
  assert.strictEqual(ev.titulo, 'Prueba A');
  assert.strictEqual(ev.presets.length, 1);
  const b = await (await fetch(BASE + '/api/e/prueba-b/evento')).text();
  assert.ok(!b.includes('clave-b'));
});

test('las direcciones antiguas redirigen al evento por defecto y los eventos inexistentes a la lista', async () => {
  const r = await fetch(BASE + '/operador', { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/prueba-a/operador');
  const n = await fetch(BASE + '/no-existe', { redirect: 'manual' });
  assert.strictEqual(n.headers.get('location'), '/');
  assert.strictEqual((await fetch(BASE + '/api/e/no-existe/estado')).status, 404);
});

test('no sirve archivos fuera de public/', async () => {
  const r = await fetch(BASE + '/..%2fserver.js');
  assert.notStrictEqual(r.status, 200);
});

test('rechaza escenas sin sesión o con una sesión inventada', async () => {
  assert.strictEqual((await escena({ asignaciones: [] }, '')).status, 401);
  assert.strictEqual((await escena({ asignaciones: [] }, 'inventada')).status, 401);
});

test('login: clave incorrecta 401, correcta entrega sesión válida; cerrar sesión la invalida', async () => {
  assert.strictEqual((await login('Concierto2025')).status, 401);
  const r = await login('secreto');
  assert.strictEqual(r.status, 200);
  const { sesion, alcance } = await r.json();
  assert.match(sesion, /^[0-9a-f]{48}$/);
  assert.strictEqual(alcance, '*');
  const estado = async () => (await fetch(BASE + '/api/sesion?evento=prueba-a', { headers: { 'x-sesion': sesion } })).json();
  assert.deepStrictEqual(await estado(), { requiereClave: true, valida: true });
  await fetch(BASE + '/api/logout', { method: 'POST', headers: { 'x-sesion': sesion } });
  assert.strictEqual((await estado()).valida, false);
});

test('la clave de un evento solo sirve para ese evento; la general sirve para todos', async () => {
  assert.strictEqual((await login('clave-b', 'prueba-a')).status, 401); // la clave de B no abre A
  const r = await login('clave-b', 'prueba-b');
  const { sesion, alcance } = await r.json();
  assert.strictEqual(alcance, 'prueba-b');
  assert.strictEqual((await escena({ asignaciones: [] }, sesion, 'prueba-b')).status, 200);
  assert.strictEqual((await escena({ asignaciones: [] }, sesion, 'prueba-a')).status, 401);
  assert.strictEqual((await escena({ asignaciones: [] }, SESION, 'prueba-b')).status, 200);
});

test('el panel y el simulador no reciben datos sin sesión', async () => {
  for (const rol of ['operador', 'simulador']) {
    const r = await fetch(BASE + '/api/e/prueba-a/events?rol=' + rol);
    assert.strictEqual(r.status, 401, rol);
  }
});

test('una escena llega por SSE solo a las zonas indicadas, programada en el futuro', async () => {
  const sse = abrirSSE('rol=publico&zona=G1');
  await esperar(200);
  const antes = Date.now();
  const r = await escena({ asignaciones: [{ zonas: ['G1'], capa: { efecto: 'ola', color: '#00FF00', angulo: 0 } }], adelantoMs: 500 });
  assert.strictEqual(r.status, 200);
  await esperar(200);
  sse.cerrar();
  const ultimo = sse.eventos.filter((e) => e.evento === 'estado').at(-1).datos;
  assert.strictEqual(ultimo.capas.G1.efecto, 'ola');
  assert.strictEqual(ultimo.capas.G1.color, '#00ff00');
  assert.ok(ultimo.capas.G1.inicio >= antes + 450);
  assert.notStrictEqual(ultimo.capas.G2.efecto, 'ola');
});

test('dos eventos no se mezclan: escenas, teléfonos y conteos van por separado', async () => {
  const telA = abrirSSE('rol=publico&zona=G3', 'prueba-a');
  const telB = abrirSSE('rol=publico&zona=G3', 'prueba-b');
  await esperar(200);
  await escena({ asignaciones: [{ zonas: 'todas', capa: { efecto: 'solido', color: '#123456' } }] }, SESION, 'prueba-b');
  await esperar(200);
  // El teléfono de A no recibió la escena de B
  assert.ok(!telA.eventos.some((e) => e.evento === 'estado' && e.datos.capas.G3.color === '#123456'));
  assert.ok(telB.eventos.some((e) => e.evento === 'estado' && e.datos.capas.G3.color === '#123456'));
  assert.notStrictEqual((await estadoDe('prueba-a')).capas.G3.color, '#123456');
  // El operador de B cuenta solo los teléfonos de B
  const telB2 = abrirSSE('rol=publico&zona=G1', 'prueba-b');
  const opB = abrirSSE('rol=operador&sesion=' + SESION, 'prueba-b');
  await esperar(300);
  const stats = opB.eventos.filter((e) => e.evento === 'stats').at(-1).datos;
  telA.cerrar(); telB.cerrar(); telB2.cerrar(); opB.cerrar();
  assert.strictEqual(stats.publico, 2);
});

test('sanea parámetros peligrosos o inválidos', async () => {
  await escena({ asignaciones: [{ zonas: 'todas', capa: { efecto: 'hackeo', color: 'red', hz: 40 } }] });
  await escena({ asignaciones: [{ zonas: ['CANCHA'], capa: { efecto: 'estrobo', hz: 40 } }] });
  const estado = await estadoDe('prueba-a');
  assert.strictEqual(estado.capas.G2.efecto, 'solido');
  assert.strictEqual(estado.capas.G2.color, '#ffffff');
  assert.strictEqual(estado.capas.CANCHA.hz, 3);
});

test('el operador recibe la ocupación real: asiento declarado y subzona de cancha', async () => {
  const recinto = await (await fetch(BASE + '/api/e/prueba-a/recinto')).json();
  // Índice global del asiento G2 fila C asiento 40 (mismo orden que el servidor)
  let idx = 0, buscado = -1;
  for (const s of recinto.sectores) if (s.tipo === 'numerada') for (const [f, a] of s.asientos) {
    if (s.id === 'G2' && f === 'C' && a === '40') buscado = idx;
    idx++;
  }
  const tel1 = abrirSSE('rol=publico&zona=G2&fila=C&asiento=40');
  const tel2 = abrirSSE('rol=publico&zona=CANCHA&profundidad=adelante&lado=izq');
  const tel3 = abrirSSE('rol=publico&zona=G1&fila=Z&asiento=999'); // asiento inexistente: no cuenta
  await esperar(300);
  const op = abrirSSE('rol=operador&sesion=' + SESION);
  await esperar(300);
  tel1.cerrar(); tel2.cerrar(); tel3.cerrar(); op.cerrar();
  const o = op.eventos.filter((e) => e.evento === 'ocupacion').at(-1).datos;
  const bits = Buffer.from(o.asientos, 'base64');
  const encendidos = [];
  for (let i = 0; i < o.totalAsientos; i++) if (bits[i >> 3] & (1 << (i & 7))) encendidos.push(i);
  assert.deepStrictEqual(encendidos, [buscado]);
  assert.strictEqual(o.generales.CANCHA['adelante-izq'], 1);
});

test('el QR de cada evento apunta a su propia dirección', async () => {
  const { urls } = await (await fetch(BASE + '/api/e/prueba-b/red')).json();
  assert.deepStrictEqual(urls, ['https://ejemplo.cl/prueba-b']);
});

const aporte = (cuerpo, ev = 'prueba-a') => fetch(`${BASE}/api/e/${ev}/aporte`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});

test('aportes de número de silla: se validan, se guardan por recinto sin repetir y solo el admin los ve', async () => {
  const base = { zona: 'CANCHA', profundidad: 'medio', lado: 'izq', dispositivo: 'telefono-de-prueba-1' };
  assert.strictEqual((await aporte({ ...base, silla: '23', fila: 'c' })).status, 200);
  assert.strictEqual((await aporte({ ...base, silla: '23', fila: 'C' })).status, 200); // repetido: no suma
  assert.strictEqual((await aporte({ ...base, silla: '41', dispositivo: 'telefono-de-prueba-2' })).status, 200);
  // Inválidos
  assert.strictEqual((await aporte({ ...base, silla: 'veinte' })).status, 400);
  assert.strictEqual((await aporte({ ...base, silla: '0' })).status, 400);
  assert.strictEqual((await aporte({ ...base, silla: '5', fila: 'muy-larga' })).status, 400);
  assert.strictEqual((await aporte({ ...base, zona: 'G1', silla: '5' })).status, 400); // sector numerado: no aplica
  assert.strictEqual((await aporte({ ...base, silla: '5', dispositivo: '' })).status, 400);

  // Resumen y CSV requieren sesión
  assert.strictEqual((await fetch(`${BASE}/api/e/prueba-a/aportes`)).status, 401);
  const resumen = await (await fetch(`${BASE}/api/e/prueba-a/aportes`, { headers: { 'x-sesion': SESION } })).json();
  assert.strictEqual(resumen.total, 2);
  const z = resumen.porZona.CANCHA;
  assert.deepStrictEqual([z.n, z.min, z.max, z.telefonos], [2, 23, 41, 2]);
  assert.deepStrictEqual(z.subzonas['medio-izq'].filas, ['C']);
  const csv = await (await fetch(`${BASE}/api/e/prueba-a/aportes?formato=csv`, { headers: { 'x-sesion': SESION } })).text();
  assert.strictEqual(csv.trim().split('\n').length, 3);
  assert.ok(!csv.includes('telefono-de-prueba')); // el identificador se guarda como huella, no tal cual

  // Persistencia: el archivo del recinto tiene las líneas aceptadas
  const lineas = fs.readFileSync(path.join(DIR_APORTES, 'demo.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(lineas.length, 3); // se registran los 3 envíos válidos; el resumen deduplica
  // Otro evento en el mismo recinto ve los mismos aportes (el mapa se arma por recinto)
  const resumenB = await (await fetch(`${BASE}/api/e/prueba-b/aportes`, { headers: { 'x-sesion': SESION } })).json();
  assert.strictEqual(resumenB.total, 2);
});

// Al final: deja la IP bloqueada un minuto
test('bloquea la IP un minuto tras 5 claves incorrectas seguidas', async () => {
  for (let i = 0; i < 5; i++) await login('mala' + i);
  const r = await login('secreto'); // incluso con la clave correcta, mientras dure el bloqueo
  assert.strictEqual(r.status, 429);
});
