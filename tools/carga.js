// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Prueba de carga: simula miles de teléfonos del público conectados a un evento y mide cuánto tarda
// en llegarles un cambio de escena.
//
//   node tools/carga.js --url http://localhost:3000 --evento demo --telefonos 3000 --clave <clave>
//
// Opciones:
//   --modo sse|poll     transporte de los teléfonos simulados (por defecto sse)
//   --poll-ms 3000      intervalo de consulta en modo poll
//   --zona CANCHA       zona general del recinto donde están los teléfonos simulados
//   --escenas 5         cambios de escena a medir (uno cada 4 s)
//   --rampa 200         teléfonos nuevos por segundo al conectar
//   --reloj-s 30        cada cuántos segundos re-sincroniza el reloj cada teléfono (0 = nunca)
//   --muestras 6        consultas a /api/time por sincronización
//   --muestras-luego 6  consultas por cada re-sincronización posterior (por defecto, igual a --muestras)
//   --espera-inicial-ms 0  espera al azar antes de la primera sincronización (repartir la estampida)
//   --minutos 0         además, mantiene la carga N minutos y reporta cada 30 s
// Úsalo contra producción solo a propósito: cada teléfono simulado es una conexión real.
const http = require('http');
const https = require('https');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const BASE = new URL((args.url || 'http://127.0.0.1:3000').replace('//localhost', '//127.0.0.1'));
const EVENTO = args.evento || 'demo';
const N = Number(args.telefonos || 1000);
const ZONA = args.zona || 'CANCHA'; // zona general del recinto donde "están" los teléfonos
const MODO = args.modo === 'poll' ? 'poll' : 'sse';
const POLL_MS = Number(args['poll-ms'] || 3000);
const ESCENAS = Number(args.escenas || 5);
const RAMPA = Number(args.rampa || 200);
const RELOJ_S = Number(args['reloj-s'] ?? 30);
const MUESTRAS = Number(args.muestras || 6);
const MINUTOS = Number(args.minutos || 0);
const MUESTRAS_LUEGO = Number(args['muestras-luego'] || MUESTRAS);
const ESPERA_INICIAL = Number(args['espera-inicial-ms'] || 0);
const cliente = BASE.protocol === 'https:' ? https : http;
// La carga de reloj y de polling sale por un pool de conexiones (un solo PC no tiene puertos para
// 10.000 sockets más); la demora del reloj la miden aparte 100 teléfonos "sonda" con conexión propia.
const agente = new cliente.Agent({ keepAlive: true, maxSockets: 512 });
const SONDAS = 100;
const agenteOperador = new cliente.Agent({ keepAlive: false }); // el operador no hace cola tras la carga ni reusa conexiones cerradas
const agentesSonda = Array.from({ length: SONDAS }, () => new cliente.Agent({ keepAlive: true, maxSockets: 1 }));

function pedir(ruta, { metodo = 'GET', cuerpo, cabeceras = {}, agent = agente } = {}) {
  return new Promise((resolve, reject) => {
    const req = cliente.request(new URL(ruta, BASE), { method: metodo, agent, headers: cabeceras }, (res) => {
      let datos = '';
      res.on('data', (d) => datos += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, datos }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

const estadisticas = { conectados: 0, errores: 0, recibido: new Map(), rtt: [], consultasReloj: 0, erroresReloj: 0 }; // version → [ms de demora]
let marcaEnvio = new Map(); // version → hora de envío

function registrar(version) {
  const enviado = marcaEnvio.get(version);
  if (!enviado) return;
  const lista = estadisticas.recibido.get(version) || [];
  lista.push(Date.now() - enviado);
  estadisticas.recibido.set(version, lista);
}

// Sincronización de reloj como la hace el teléfono: varias consultas seguidas a /api/time
async function sincronizar(i, muestras = MUESTRAS) {
  const agent = i < SONDAS ? agentesSonda[i] : agente;
  for (let k = 0; k < muestras; k++) {
    const t0 = Date.now();
    try {
      const r = await pedir('/api/time', { agent });
      estadisticas.consultasReloj++;
      if (r.status !== 200) estadisticas.erroresReloj++;
      else if (i < SONDAS) estadisticas.rtt.push(Date.now() - t0);
    } catch { estadisticas.erroresReloj++; }
  }
}
function relojPeriodico(i) {
  setTimeout(() => sincronizar(i, MUESTRAS), Math.random() * ESPERA_INICIAL);
  if (RELOJ_S > 0) setTimeout(function ciclo() { sincronizar(i, MUESTRAS_LUEGO); setTimeout(ciclo, RELOJ_S * 1000 * (0.8 + Math.random() * 0.4)); }, Math.random() * RELOJ_S * 1000);
}

function telefonoSse(i) {
  const q = new URLSearchParams({ rol: 'publico', zona: ZONA, profundidad: 'medio', lado: 'centro' });
  const req = cliente.get(new URL(`/api/e/${EVENTO}/events?${q}`, BASE), { agent: false }, (res) => {
    if (res.statusCode !== 200) { estadisticas.errores++; res.resume(); return; }
    estadisticas.conectados++;
    relojPeriodico(i);
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (d) => {
      buffer += d;
      let corte;
      while ((corte = buffer.indexOf('\n\n')) >= 0) {
        const bloque = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        const m = /event: estado\ndata: (.*)/.exec(bloque);
        if (m) registrar(JSON.parse(m[1]).version);
      }
    });
    res.on('close', () => estadisticas.conectados--);
  });
  req.on('error', () => estadisticas.errores++);
}

function telefonoPoll(i) {
  let etag = '';
  const disp = 'carga-' + i.toString(36).padStart(8, '0');
  const ciclo = async () => {
    try {
      const q = new URLSearchParams({ zona: ZONA, profundidad: 'medio', lado: 'centro', disp });
      const r = await pedir(`/api/e/${EVENTO}/estado?${q}`, { cabeceras: etag ? { 'If-None-Match': etag } : {} });
      if (r.status === 200) { etag = r.headers.etag || ''; registrar(JSON.parse(r.datos).version); }
      else if (r.status !== 304) estadisticas.errores++;
    } catch { estadisticas.errores++; }
    setTimeout(ciclo, POLL_MS * (0.8 + Math.random() * 0.4));
  };
  estadisticas.conectados++;
  relojPeriodico(i);
  setTimeout(ciclo, Math.random() * POLL_MS);
}

process.on('unhandledRejection', (e) => { estadisticas.errores++; });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const percentil = (lista, p) => lista.slice().sort((a, b) => a - b)[Math.min(lista.length - 1, Math.floor(lista.length * p))];

(async () => {
  process.on('uncaughtException', (e) => { console.error('Error:', e.message); process.exit(1); });
  console.log(`Prueba de carga: ${N} teléfonos (${MODO}) → ${BASE.origin}/${EVENTO}`);
  const login = await pedir('/api/login', { metodo: 'POST', cuerpo: JSON.stringify({ clave: args.clave || '', evento: EVENTO }), cabeceras: { 'Content-Type': 'application/json' } });
  const sesion = JSON.parse(login.datos).sesion;
  if (!sesion) { console.error('No se pudo iniciar sesión:', login.datos); process.exit(1); }

  const inicio = Date.now();
  for (let i = 0; i < N; i++) {
    (MODO === 'sse' ? telefonoSse : telefonoPoll)(i);
    if (i % RAMPA === RAMPA - 1) await pausa(1000);
  }
  await pausa(3000);
  console.log(`Conectados: ${estadisticas.conectados} de ${N} en ${((Date.now() - inicio) / 1000).toFixed(1)} s (errores: ${estadisticas.errores})`);

  const COLORES = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
  for (let k = 0; k < ESCENAS; k++) {
    const t0 = Date.now();
    const r = await pedir(`/api/e/${EVENTO}/escena`, {
      metodo: 'POST', agent: agenteOperador, cabeceras: { 'Content-Type': 'application/json', 'x-sesion': sesion },
      cuerpo: JSON.stringify({ asignaciones: [{ zonas: 'todas', capa: { efecto: 'solido', color: COLORES[k % COLORES.length] } }] }),
    });
    const { version } = JSON.parse(r.datos);
    marcaEnvio.set(version, t0);
    await pausa(MODO === 'poll' ? POLL_MS * 1.5 + 1500 : 4000);
    const lista = estadisticas.recibido.get(version) || [];
    console.log(`Escena ${k + 1}: POST ${Date.now() - t0 > 0 ? (r.status) : ''} · llegó a ${lista.length}/${estadisticas.conectados}` +
      (lista.length ? ` · demora p50 ${percentil(lista, 0.5)} ms, p95 ${percentil(lista, 0.95)} ms, máx ${Math.max(...lista)} ms` : ''));
  }
  const resumenReloj = (etiqueta, desde) => {
    const rtt = estadisticas.rtt;
    const s = (Date.now() - desde) / 1000;
    console.log(`${etiqueta}: ${(estadisticas.consultasReloj / s).toFixed(0)} consultas de reloj/s · RTT p50 ${percentil(rtt, 0.5)} ms, p95 ${percentil(rtt, 0.95)} ms, máx ${Math.max(...rtt)} ms · errores reloj ${estadisticas.erroresReloj} · conectados ${estadisticas.conectados}`);
    estadisticas.rtt = []; estadisticas.consultasReloj = 0;
  };
  resumenReloj('Reloj (conexión + escenas)', inicio);
  for (let m = 0; m < MINUTOS * 2; m++) {
    const desde = Date.now();
    await pausa(30000);
    resumenReloj(`Reloj, minuto ${((m + 1) / 2).toFixed(1)}`, desde);
  }
  console.log(`Errores de conexión totales: ${estadisticas.errores}`);
  process.exit(0);
})().catch((e) => { console.error('La prueba se detuvo:', e.message); process.exit(1); });
