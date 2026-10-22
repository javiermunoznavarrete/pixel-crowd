const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let proc;

test.before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, OP_TOKEN: 'secreto', RECINTO: 'demo' } });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('Ctrl+C') && resolve());
    proc.on('exit', (c) => reject(new Error('el servidor terminó con código ' + c)));
  });
});
test.after(() => proc.kill());

const escena = (cuerpo, token = 'secreto') => fetch(BASE + '/api/escena', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': token }, body: JSON.stringify(cuerpo),
});

// Abre un stream SSE y devuelve los eventos recibidos a medida que llegan.
function abrirSSE(query) {
  const eventos = [];
  const req = http.get(`${BASE}/api/events?${query}`, (res) => {
    let buf = '';
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(bloque), data = /^data: (.+)$/m.exec(bloque);
        if (ev && data) eventos.push({ evento: ev[1], datos: JSON.parse(data[1]) });
      }
    });
  });
  return { eventos, cerrar: () => req.destroy() };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('sirve las páginas y el recinto con los asientos del CSV', async () => {
  for (const p of ['/', '/operador', '/simulador', '/show.js']) assert.strictEqual((await fetch(BASE + p)).status, 200, p);
  const recinto = await (await fetch(BASE + '/api/recinto')).json();
  const g1 = recinto.sectores.find((s) => s.id === 'G1');
  assert.strictEqual(g1.asientos.length, 12 * 85);
});

test('no sirve archivos fuera de public/', async () => {
  const r = await fetch(BASE + '/..%2fserver.js');
  assert.notStrictEqual(r.status, 200);
});

test('rechaza escenas sin token', async () => {
  assert.strictEqual((await escena({ asignaciones: [] }, 'malo')).status, 401);
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

test('sanea parámetros peligrosos o inválidos', async () => {
  await escena({ asignaciones: [{ zonas: 'todas', capa: { efecto: 'hackeo', color: 'red', hz: 40 } }] });
  await escena({ asignaciones: [{ zonas: ['CANCHA'], capa: { efecto: 'estrobo', hz: 40 } }] });
  const estado = await (await fetch(BASE + '/api/estado')).json();
  assert.strictEqual(estado.capas.G2.efecto, 'solido');
  assert.strictEqual(estado.capas.G2.color, '#ffffff');
  assert.strictEqual(estado.capas.CANCHA.hz, 3);
});

test('el operador recibe el conteo de teléfonos por zona', async () => {
  const tel = abrirSSE('rol=publico&zona=G3');
  const op = abrirSSE('rol=operador');
  await esperar(300);
  const stats = op.eventos.filter((e) => e.evento === 'stats').at(-1).datos;
  tel.cerrar(); op.cerrar();
  assert.ok(stats.porZona.G3 >= 1);
});
