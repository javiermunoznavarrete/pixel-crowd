// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Servidor de Pixel Crowd: sin dependencias, solo Node >= 18. Atiende varios eventos a la vez.
//   /                      → lista de eventos
//   /<evento>              → web del público de ese evento
//   /<evento>/operador     → panel del operador
//   /<evento>/simulador    → vista del recinto con teléfonos virtuales
//   /<evento>/conectar     → QR para proyectar
// Cada evento tiene su propio estado en vivo. Los teléfonos lo reciben por Server-Sent Events (o, si su
// red no lo permite, consultando /estado cada pocos segundos) y calculan sus colores localmente.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DIR_EVENTOS = process.env.EVENTOS_DIR || path.join(__dirname, 'data', 'eventos');
// Carpetas donde buscar recintos, en orden: RECINTOS_DIR (puede ser una lista separada por ";" en Windows
// o ":" en Linux), el repositorio privado de recintos clonado al lado de este, y data/recintos (el demo).
// Los mapas de recintos reales viven en un repositorio privado y no se publican con el código.
const DIRS_RECINTOS = [...new Set([
  ...(process.env.RECINTOS_DIR || '').split(path.delimiter).filter(Boolean),
  path.join(__dirname, '..', 'pixel-crowd-recintos', 'recintos'),
  path.join(__dirname, 'data', 'recintos'),
].map((d) => path.resolve(d)))].filter((d) => fs.existsSync(d));
const ZONA_HORARIA = 'America/Santiago';

// ---------- Claves ----------
// Clave general (entra a todos los eventos): CLAVE_ADMIN (u OP_TOKEN, nombre anterior) o clave-admin.txt.
// Clave de un evento (solo entra a ese): CLAVE_EVENTO_<SLUG> o data/eventos/<slug>/clave.txt.
// Ningún archivo de clave se sube a git. Sin ninguna clave, el panel queda abierto (solo para pruebas).
function leerArchivo(ruta) { try { return fs.readFileSync(ruta, 'utf8').trim(); } catch { return ''; } }
const CLAVE_ADMIN = process.env.CLAVE_ADMIN || process.env.OP_TOKEN || leerArchivo(path.join(__dirname, 'clave-admin.txt'));
const huella = (texto) => crypto.createHash('sha256').update(String(texto)).digest();
const HUELLA_ADMIN = CLAVE_ADMIN ? huella(CLAVE_ADMIN) : null;
const DURACION_SESION = 12 * 60 * 60 * 1000;
const MAX_INTENTOS = 5; // intentos fallidos seguidos antes de bloquear esa IP un minuto
const sesiones = new Map(); // token → { vence, alcance: '*' | slug }
const intentos = new Map(); // ip → { fallidos, bloqueadoHasta }

// Comparación en tiempo constante (sobre huellas del mismo largo) para no filtrar la clave por tiempos
const coincide = (clave, h) => !!h && crypto.timingSafeEqual(huella(clave), h);

const requiereClave = (ev) => !!(HUELLA_ADMIN || (ev && ev.huellaClave));

function sesionValida(token, ev) {
  if (!requiereClave(ev)) return true;
  const s = token && sesiones.get(token);
  if (!s) return false;
  if (s.vence < Date.now()) { sesiones.delete(token); return false; }
  return s.alcance === '*' || (ev && s.alcance === ev.slug);
}

// ---------- Recintos ----------
const cacheRecintos = new Map();
function cargarRecinto(nombre) {
  if (cacheRecintos.has(nombre)) return cacheRecintos.get(nombre);
  const dir = DIRS_RECINTOS.map((d) => path.join(d, nombre)).find((d) => fs.existsSync(path.join(d, 'recinto.json')));
  if (!dir) return null;
  const recinto = JSON.parse(fs.readFileSync(path.join(dir, 'recinto.json'), 'utf8'));
  const porId = Object.fromEntries(recinto.sectores.map((s) => [s.id, s]));
  for (const s of recinto.sectores) if (s.tipo === 'numerada') s.asientos = [];

  const lineas = fs.readFileSync(path.join(dir, 'asientos.csv'), 'utf8').split(/\r?\n/);
  lineas.slice(1).forEach((linea, i) => {
    if (!linea.trim()) return;
    // col (opcional): columna del asiento en la grilla del sector, vista desde la cancha (para mosaicos)
    const [sector, fila, asiento, x, y, col] = linea.split(',').map((v) => v.trim());
    const s = porId[sector];
    if (!s || s.tipo !== 'numerada') throw new Error(`${nombre}/asientos.csv línea ${i + 2}: sector "${sector}" no existe o no es numerado`);
    const a = [fila, asiento, Number(x), Number(y)];
    if (col !== undefined && col !== '') a.push(Number(col));
    s.asientos.push(a);
  });

  // Índice global de cada asiento, en el mismo orden en que aparecen en el JSON del recinto.
  // La ocupación se informa como un bitset sobre este índice (~1 KB para 8.000 asientos).
  const indice = new Map();
  let total = 0;
  for (const s of recinto.sectores) {
    if (s.tipo === 'numerada') for (const [fila, asiento] of s.asientos) indice.set(`${s.id}|${fila}|${asiento}`, total++);
  }
  const datos = { recinto, json: JSON.stringify(recinto), indice, total, zonas: recinto.sectores.map((s) => s.id) };
  cacheRecintos.set(nombre, datos);
  return datos;
}

// ---------- Eventos ----------
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const PAGINAS = { operador: 'operador.html', simulador: 'simulador.html', conectar: 'conectar.html' };
const RESERVADOS = new Set(['api', 'vendor', ...Object.keys(PAGINAS)]);
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }); // AAAA-MM-DD en Chile

function cargarEventos() {
  const eventos = new Map();
  for (const slug of fs.readdirSync(DIR_EVENTOS).sort()) {
    const dir = path.join(DIR_EVENTOS, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!SLUG.test(slug) || RESERVADOS.has(slug)) throw new Error(`Nombre de evento no válido: "${slug}" (usa minúsculas, números y guiones)`);
    const def = JSON.parse(fs.readFileSync(path.join(dir, 'evento.json'), 'utf8'));
    const datosRecinto = cargarRecinto(def.recinto);
    if (!datosRecinto) { // p. ej. una copia del código sin el repositorio privado de recintos
      console.warn(`  Aviso: se omite el evento "${slug}" porque no se encontró el recinto "${def.recinto}".`);
      continue;
    }
    const clave = process.env['CLAVE_EVENTO_' + slug.toUpperCase().replace(/-/g, '_')] || leerArchivo(path.join(dir, 'clave.txt'));
    const ev = {
      slug, def: { ...def, slug }, ...datosRecinto,
      huellaClave: clave ? huella(clave) : null,
      // cola: por zona, la capa que está sonando y las que vienen, ordenadas por inicio. Varias zonas
      // comparten el mismo objeto de capa cuando reciben el mismo cambio.
      estado: { version: 0, cola: {} },
      ultimaOcupacion: '',
      estadoTexto: null, // estado serializado (se arma una vez por cambio, no una vez por teléfono)
    };
    const reposo = nuevaCapa({ efecto: 'pulso', color: '#3a2a80', color2: '#000000', bpm: 30 }, 0);
    for (const z of ev.zonas) ev.estado.cola[z] = [reposo];
    eventos.set(slug, ev);
  }
  if (!eventos.size) throw new Error(`No hay eventos en ${DIR_EVENTOS}`);
  return eventos;
}

// proximo | hoy | terminado, según la fecha del evento en Chile
function situacion(def) {
  if (!def.fechaISO) return 'proximo';
  const h = hoy();
  return def.fechaISO > h ? 'proximo' : def.fechaISO === h ? 'hoy' : 'terminado';
}

const resumenPublico = (ev) => ({
  slug: ev.slug, titulo: ev.def.titulo, lugar: ev.def.lugar, fecha: ev.def.fecha, fechaISO: ev.def.fechaISO,
  situacion: situacion(ev.def), requiereClave: requiereClave(ev),
});

// Evento al que llevan las direcciones antiguas (/operador, /conectar…): el próximo visible
function eventoPorDefecto() {
  const visibles = [...eventos.values()].filter((e) => !e.def.oculto);
  const vigentes = visibles.filter((e) => situacion(e.def) !== 'terminado')
    .sort((a, b) => String(a.def.fechaISO).localeCompare(String(b.def.fechaISO)));
  return vigentes[0] || visibles[0] || [...eventos.values()][0];
}

// ---------- Estado del show ----------
const EFECTOS = ['solido', 'pulso', 'estrobo', 'ola', 'onda', 'arcoiris', 'texto', 'bandera', 'tela'];
let contadorCapas = 0;

function nuevaCapa(datos, inicio) {
  const num = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : def);
  const color = (v, def) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);
  return {
    id: ++contadorCapas,
    efecto: EFECTOS.includes(datos.efecto) ? datos.efecto : 'solido',
    color: color(datos.color, '#ffffff'),
    color2: color(datos.color2, '#000000'),
    velocidad: num(datos.velocidad, 0, 200, 20),
    bpm: num(datos.bpm, 10, 240, 60),
    hz: num(datos.hz, 0.5, 3, 2), // estrobo limitado a 3 Hz (seguridad fotosensible)
    angulo: num(datos.angulo, -360, 360, 90),
    texto: String(datos.texto || '').slice(0, 60),
    modo: datos.modo === 'sector' ? 'sector' : 'completa', // bandera/tela: todo el público o una por sector
    pais: datos.pais === 'japon' ? 'japon' : 'chile', // bandera: Chile o Japón
    inicio,
  };
}

const eventos = cargarEventos();
const SUBZONAS = new Set(['adelante', 'medio', 'atras'].flatMap((p) => ['izq', 'centro', 'der'].map((l) => `${p}-${l}`)));

// Ubicación declarada por un teléfono (validada contra el mapa del evento); null si no es válida.
function ubicacionDe(ev, params) {
  const s = ev.recinto.sectores.find((x) => x.id === params.get('zona'));
  if (!s) return null;
  if (s.tipo === 'numerada') {
    const idx = ev.indice.get(`${s.id}|${params.get('fila')}|${params.get('asiento')}`);
    return idx === undefined ? null : { asiento: idx };
  }
  const sub = `${params.get('profundidad')}-${params.get('lado')}`;
  return SUBZONAS.has(sub) ? { subzona: sub } : null;
}

// ---------- Clientes ----------
// Por conexión abierta (SSE), o por consultas periódicas a /estado para los teléfonos cuya red no
// sostiene la conexión: esos se recuerdan unos segundos después de cada consulta.
const clientes = new Set(); // { res, ev, rol, zona, ubicacion }
const CONSULTA_MS = Number(process.env.CONSULTA_MS) || 3000;
const consultantes = new Map(); // disp → { ev, rol: 'publico', zona, ubicacion, vence }

// Todos los teléfonos del público de un evento, por cualquiera de las dos vías
function* publicoDe(ev) {
  for (const c of clientes) if (c.ev === ev && c.rol === 'publico') yield c;
  for (const c of consultantes.values()) if (c.ev === ev) yield c;
}

function enviar(res, evento, datos) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
}

// Estado tal como viaja a los teléfonos: cada capa una sola vez (capas: id → capa) y la cola de cada
// zona como lista de ids. Con 32 zonas que reciben el mismo cambio pesa ~1 KB en vez de ~18 KB.
function estadoJson(ev) {
  if (ev.estadoTexto) return ev.estadoTexto;
  const capas = {}, cola = {};
  for (const [z, lista] of Object.entries(ev.estado.cola)) {
    cola[z] = lista.map((c) => { capas[c.id] = c; return c.id; });
  }
  return (ev.estadoTexto = JSON.stringify({ version: ev.estado.version, capas, cola }));
}

function difundirEstado(ev) {
  const mensaje = `event: estado
data: ${estadoJson(ev)}

`;
  for (const c of clientes) if (c.ev === ev) c.res.write(mensaje);
}

function stats(ev) {
  const porZona = Object.fromEntries(ev.zonas.map((z) => [z, 0]));
  let publico = 0, conexiones = 0, porConsultas = 0;
  for (const c of clientes) if (c.ev === ev) conexiones++;
  for (const c of publicoDe(ev)) {
    publico++;
    if (!c.res) porConsultas++;
    if (c.zona in porZona) porZona[c.zona]++;
  }
  return { publico, porZona, conexiones, porConsultas };
}

// Qué asientos tienen un teléfono conectado y cuántos hay en cada subzona de las zonas generales
function ocupacion(ev) {
  const bits = Buffer.alloc(Math.ceil(ev.total / 8));
  const generales = {};
  for (const c of publicoDe(ev)) {
    if (!c.ubicacion) continue;
    if (c.ubicacion.asiento !== undefined) bits[c.ubicacion.asiento >> 3] |= 1 << (c.ubicacion.asiento & 7);
    else {
      const g = (generales[c.zona] ||= {});
      g[c.ubicacion.subzona] = (g[c.ubicacion.subzona] || 0) + 1;
    }
  }
  return { totalAsientos: ev.total, asientos: bits.toString('base64'), generales };
}

const OBSERVADORES = new Set(['operador', 'simulador']);

// Cada 2 s: conteos al panel y ocupación al panel y al simulador. Al público, una señal de vida cada
// 16 s: basta para que el proxy de Railway (corta tras 60 s sin datos) no cierre la conexión, y con
// miles de teléfonos ahorra muchas escrituras.
let vuelta = 0;
setInterval(() => {
  const t = Date.now();
  for (const [disp, c] of consultantes) if (c.vence < t) consultantes.delete(disp);
  const pingPublico = ++vuelta % 8 === 0;
  for (const ev of eventos.values()) {
    podarColas(ev, t);
    const s = stats(ev);
    registrarEstadisticas(ev, s, t);
    const o = ocupacion(ev);
    const oJson = JSON.stringify(o);
    const cambio = oJson !== ev.ultimaOcupacion;
    ev.ultimaOcupacion = oJson;
    for (const c of clientes) {
      if (c.ev !== ev) continue;
      if (c.rol === 'operador') enviar(c.res, 'stats', s);
      else if (OBSERVADORES.has(c.rol)) { if (cambio) enviar(c.res, 'ocupacion', o); else c.res.write(': ping\n\n'); }
      else if (pingPublico) c.res.write(': ping\n\n');
    }
  }
}, 2000);

// GET /api/e/<evento>/estado?zona=…&disp=… — para los teléfonos que consultan en vez de mantener la
// conexión. Responde 304 si el estado no cambió desde su última consulta (ETag = versión) y en cada
// respuesta envía la hora del servidor (muestra de reloj) y cada cuánto volver a consultar.
function responderEstado(ev, req, res, url) {
  const disp = url.searchParams.get('disp');
  if (disp && /^[0-9a-z-]{8,64}$/i.test(disp)) {
    consultantes.set(disp, { ev, rol: 'publico', zona: url.searchParams.get('zona'), ubicacion: ubicacionDe(ev, url.searchParams), vence: Date.now() + CONSULTA_MS * 3 });
  }
  const etag = `"${ev.slug}-${ev.estado.version}"`;
  const cabeceras = {
    'Cache-Control': 'no-store', ETag: etag, 'X-Ahora': String(Date.now()), 'X-Consulta-Ms': String(CONSULTA_MS),
    'Access-Control-Expose-Headers': 'ETag, X-Ahora, X-Consulta-Ms',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, cabeceras); return res.end(); }
  res.writeHead(200, { ...cabeceras, 'Content-Type': 'application/json' });
  res.end(estadoJson(ev));
}

// ---------- Estadísticas de cada show ----------
// Una "sesión" de show empieza cuando un evento supera UMBRAL_SESION teléfonos conectados (los ensayos y
// pruebas chicas no cuentan) y termina cuando pasa CIERRE_SESION_MS seguidos en el umbral o por debajo; si
// vuelve a subir antes (un intermedio, un reinicio del servidor), es la misma sesión. De cada sesión se
// guarda el máximo con su hora y desglose por zona, y una muestra por minuto. Sin datos personales: solo
// conteos. Un archivo JSON por evento en DATA_ESTADISTICAS (en Railway, el volumen /data).
const DIR_ESTADISTICAS = process.env.DATA_ESTADISTICAS || path.join(__dirname, 'estadisticas');
const UMBRAL_SESION = Number(process.env.UMBRAL_SESION) || 50;
const CIERRE_SESION_MS = Number(process.env.CIERRE_SESION_MS) || 10 * 60 * 1000;
const MUESTRA_MS = Number(process.env.MUESTRA_MS) || 60 * 1000;
const GUARDADO_MS = 10 * 1000; // el máximo se escribe a disco a lo más cada 10 s

const archivoEstadisticas = (slug) => path.join(DIR_ESTADISTICAS, `${slug}.json`);

function estadisticasDe(ev) {
  if (ev.estadisticas) return ev.estadisticas;
  let datos = { sesiones: [] };
  try { datos = JSON.parse(fs.readFileSync(archivoEstadisticas(ev.slug), 'utf8')); } catch { /* aún no hay */ }
  // Una sesión que quedó abierta (el servidor se reinició a mitad del show) sigue si es reciente; si no, se cierra
  const ultima = datos.sesiones.at(-1);
  if (ultima && !ultima.fin && Date.now() - (ultima.actualizada || ultima.inicio) > CIERRE_SESION_MS) {
    ultima.fin = ultima.actualizada || ultima.inicio;
  }
  return (ev.estadisticas = datos);
}

function guardarEstadisticas(ev) {
  fs.mkdirSync(DIR_ESTADISTICAS, { recursive: true });
  const destino = archivoEstadisticas(ev.slug);
  fs.writeFileSync(destino + '.tmp', JSON.stringify(ev.estadisticas));
  fs.renameSync(destino + '.tmp', destino); // reemplazo atómico: nunca queda un archivo a medias
  ev.estadisticasGuardadas = Date.now();
}

function registrarEstadisticas(ev, s, t) {
  const datos = estadisticasDe(ev);
  let sesion = datos.sesiones.at(-1);
  if (sesion && sesion.fin) sesion = null;
  const sobre = s.publico > UMBRAL_SESION;
  if (!sesion) {
    if (!sobre) return;
    sesion = { inicio: t, fin: null, pico: null, muestras: [], bajoDesde: null };
    datos.sesiones.push(sesion);
    console.log(`  Comienza una sesión de "${ev.def.titulo}": ${s.publico} teléfonos conectados`);
  }
  sesion.actualizada = t;
  let cambio = false;
  if (!sesion.pico || s.publico > sesion.pico.total) {
    sesion.pico = { total: s.publico, t, porZona: s.porZona, porConsultas: s.porConsultas };
    cambio = true;
  }
  const ultimaMuestra = sesion.muestras.at(-1);
  if (!ultimaMuestra || t - ultimaMuestra.t >= MUESTRA_MS) {
    sesion.muestras.push({ t, total: s.publico, porConsultas: s.porConsultas, porZona: s.porZona });
    cambio = true;
  }
  if (sobre) sesion.bajoDesde = null;
  else {
    sesion.bajoDesde ||= t;
    if (t - sesion.bajoDesde >= CIERRE_SESION_MS) {
      sesion.fin = sesion.bajoDesde;
      delete sesion.bajoDesde;
      cambio = true;
      console.log(`  Termina la sesión de "${ev.def.titulo}": máximo ${sesion.pico.total} teléfonos`);
    }
  }
  if (cambio && (sesion.fin || !ev.estadisticasGuardadas || t - ev.estadisticasGuardadas >= GUARDADO_MS || sesion.muestras.at(-1).t === t)) {
    try { guardarEstadisticas(ev); } catch (e) { console.error('  No se pudieron guardar las estadísticas:', e.message); }
  }
}

// GET /api/e/<evento>/estadisticas[?formato=csv] — sesiones del show (solo el operador)
function verEstadisticas(ev, req, res, url) {
  if (!sesionValida(req.headers['x-sesion'], ev)) return json(res, 401, { error: 'Sesión inválida o vencida' });
  const { sesiones } = estadisticasDe(ev);
  if (url.searchParams.get('formato') === 'csv') {
    const zonas = ev.zonas;
    const hora = (t) => new Date(t).toLocaleString('sv-SE', { timeZone: ZONA_HORARIA }); // AAAA-MM-DD HH:MM:SS, hora de Chile
    const filas = [['sesion', 'hora', 'total', 'senal_debil', ...zonas].join(',')];
    sesiones.forEach((se, i) => {
      for (const m of se.muestras) filas.push([i + 1, hora(m.t), m.total, m.porConsultas || 0, ...zonas.map((z) => m.porZona?.[z] || 0)].join(','));
    });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="estadisticas-${ev.slug}.csv"`,
    });
    return res.end(filas.join('\n') + '\n');
  }
  json(res, 200, { umbral: UMBRAL_SESION, zonas: ev.zonas, sesiones });
}

// ---------- Aportes de números de silla ----------
// En zonas sin numerar (p. ej. las graderías del Caupolicán) el público puede indicar, de forma opcional,
// la fila y el número que ve en su silla. Se guardan por recinto, sin datos personales (el teléfono se
// identifica con una huella anónima), para reconstruir con el tiempo el mapa numerado.
const DIR_APORTES = process.env.DATA_APORTES || path.join(__dirname, 'aportes');
const LIMITE_APORTES = { cantidad: 20, ventanaMs: 10 * 60 * 1000 }; // por IP
const aportesPorRecinto = new Map(); // recinto → Map(clave → aporte)
const enviosPorIp = new Map(); // ip → [marcas de tiempo]

const claveAporte = (a) => `${a.disp}|${a.zona}|${a.fila}|${a.silla}`;
const archivoAportes = (recinto) => path.join(DIR_APORTES, `${recinto}.jsonl`);

function aportesDe(recinto) {
  if (aportesPorRecinto.has(recinto)) return aportesPorRecinto.get(recinto);
  const mapa = new Map();
  for (const linea of leerArchivo(archivoAportes(recinto)).split('\n')) {
    if (!linea.trim()) continue;
    try { const a = JSON.parse(linea); mapa.set(claveAporte(a), a); } catch { /* línea dañada: se ignora */ }
  }
  aportesPorRecinto.set(recinto, mapa);
  return mapa;
}

// POST /api/e/<evento>/aporte { zona, profundidad, lado, fila?, silla, dispositivo }
async function recibirAporte(ev, req, res) {
  const ip = req.socket.remoteAddress;
  const ahora = Date.now();
  const marcas = (enviosPorIp.get(ip) || []).filter((t) => ahora - t < LIMITE_APORTES.ventanaMs);
  if (marcas.length >= LIMITE_APORTES.cantidad) return json(res, 429, { error: 'Demasiados envíos, intenta más tarde' });

  let d;
  try { d = JSON.parse(await leerCuerpo(req, 2048)); } catch { return json(res, 400, { error: 'JSON inválido' }); }
  const s = ev.recinto.sectores.find((x) => x.id === d.zona);
  const subzona = `${d.profundidad}-${d.lado}`;
  const silla = String(d.silla ?? '').trim();
  const fila = String(d.fila ?? '').trim().toUpperCase();
  const disp = String(d.dispositivo ?? '');
  if (!s || s.tipo !== 'general') return json(res, 400, { error: 'Zona no válida' });
  if (!SUBZONAS.has(subzona)) return json(res, 400, { error: 'Parte de la zona no válida' });
  if (!/^\d{1,4}$/.test(silla) || Number(silla) < 1) return json(res, 400, { error: 'El número de silla debe ser un número entre 1 y 9999' });
  if (fila && !/^[A-Z0-9]{1,4}$/.test(fila)) return json(res, 400, { error: 'La fila debe tener hasta 4 letras o números' });
  if (disp.length < 8 || disp.length > 64) return json(res, 400, { error: 'Falta el identificador del teléfono' });

  const aporte = {
    t: new Date(ahora).toISOString(), evento: ev.slug, recinto: ev.def.recinto, zona: s.id, subzona,
    fila, silla: Number(silla), disp: crypto.createHash('sha256').update(disp).digest('hex').slice(0, 16),
  };
  marcas.push(ahora);
  enviosPorIp.set(ip, marcas);
  fs.mkdirSync(DIR_APORTES, { recursive: true });
  fs.appendFileSync(archivoAportes(ev.def.recinto), JSON.stringify(aporte) + '\n');
  aportesDe(ev.def.recinto).set(claveAporte(aporte), aporte);
  json(res, 200, { ok: true });
}

// GET /api/e/<evento>/aportes[?formato=csv] — resumen por zona y celda, o todos los aportes en CSV
function verAportes(ev, req, res, url) {
  if (!sesionValida(req.headers['x-sesion'], ev)) return json(res, 401, { error: 'Sesión inválida o vencida' });
  const lista = [...aportesDe(ev.def.recinto).values()];
  if (url.searchParams.get('formato') === 'csv') {
    const filas = ['fecha,evento,zona,subzona,fila,silla,telefono', ...lista.map((a) => [a.t, a.evento, a.zona, a.subzona, a.fila, a.silla, a.disp].join(','))];
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="aportes-${ev.def.recinto}.csv"`,
    });
    return res.end(filas.join('\n') + '\n');
  }
  const porZona = {};
  for (const a of lista) {
    const z = (porZona[a.zona] ||= { nombre: ev.recinto.sectores.find((s) => s.id === a.zona)?.nombre || a.zona, n: 0, min: a.silla, max: a.silla, telefonos: new Set(), subzonas: {} });
    z.n++; z.min = Math.min(z.min, a.silla); z.max = Math.max(z.max, a.silla); z.telefonos.add(a.disp);
    const c = (z.subzonas[a.subzona] ||= { n: 0, min: a.silla, max: a.silla, filas: new Set() });
    c.n++; c.min = Math.min(c.min, a.silla); c.max = Math.max(c.max, a.silla);
    if (a.fila) c.filas.add(a.fila);
  }
  for (const z of Object.values(porZona)) {
    z.telefonos = z.telefonos.size;
    for (const c of Object.values(z.subzonas)) c.filas = [...c.filas].sort();
  }
  json(res, 200, { recinto: ev.def.recinto, total: lista.length, porZona });
}

// ---------- HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

// IPs de la red local, con WiFi/Ethernet primero. Se descartan adaptadores virtuales y VPN,
// que los teléfonos de la misma WiFi no pueden alcanzar.
const VIRTUALES = /vEthernet|VMware|VirtualBox|WSL|Hyper-V|Tailscale|NordLynx|ZeroTier|Hamachi|docker|vboxnet|utun|tun\d|wg\d/i;
function ipsLocales() {
  const lista = [];
  for (const [nombre, ifaces] of Object.entries(os.networkInterfaces())) {
    if (VIRTUALES.test(nombre)) continue;
    for (const i of ifaces || []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      lista.push({ nombre, ip: i.address, prioridad: /wi-?fi|wlan|wireless|en0/i.test(nombre) ? 0 : /ethernet|eth|en\d/i.test(nombre) ? 1 : 2 });
    }
  }
  return lista.sort((a, b) => a.prioridad - b.prioridad);
}
const urlPublico = (ip) => `http://${ip}${PORT === 80 ? '' : ':' + PORT}/`;

// URLs con las que los teléfonos entran a un evento (URL_PUBLICO es la base, p. ej. el dominio de Railway)
function urlsEvento(ev) {
  const bases = process.env.URL_PUBLICO ? [process.env.URL_PUBLICO] : ipsLocales().map((i) => urlPublico(i.ip));
  return bases.map((b) => b.replace(/\/?$/, '/') + ev.slug);
}

function json(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

function redirigir(res, destino) {
  res.writeHead(302, { Location: destino });
  res.end();
}

function leerCuerpo(req, limite = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    req.on('data', (d) => {
      cuerpo += d;
      if (cuerpo.length > limite) { reject(new Error('cuerpo demasiado grande')); req.destroy(); }
    });
    req.on('end', () => resolve(cuerpo));
    req.on('error', reject);
  });
}

// POST /api/login { clave, evento? } → { sesion, vence, alcance }
// La clave general da acceso a todos los eventos; la clave de un evento, solo a ese.
async function iniciarSesion(req, res) {
  let datos;
  try { datos = JSON.parse(await leerCuerpo(req, 2048)); } catch { return json(res, 400, { error: 'JSON inválido' }); }
  const ev = datos.evento ? eventos.get(datos.evento) : null;
  if (!requiereClave(ev)) return json(res, 200, { sesion: 'abierta', abierto: true, alcance: '*' });

  const ip = req.socket.remoteAddress;
  const i = intentos.get(ip) || { fallidos: 0, bloqueadoHasta: 0 };
  if (i.bloqueadoHasta > Date.now()) {
    return json(res, 429, { error: `Demasiados intentos. Espera ${Math.ceil((i.bloqueadoHasta - Date.now()) / 1000)} s.` });
  }
  const clave = String(datos.clave || '');
  const alcance = coincide(clave, HUELLA_ADMIN) ? '*' : (ev && coincide(clave, ev.huellaClave) ? ev.slug : null);
  if (!alcance) {
    i.fallidos++;
    if (i.fallidos >= MAX_INTENTOS) { i.fallidos = 0; i.bloqueadoHasta = Date.now() + 60 * 1000; }
    intentos.set(ip, i);
    return json(res, 401, { error: 'Clave incorrecta' });
  }
  intentos.delete(ip);
  const sesion = crypto.randomBytes(24).toString('hex');
  const vence = Date.now() + DURACION_SESION;
  sesiones.set(sesion, { vence, alcance });
  json(res, 200, { sesion, vence, alcance });
}

// Deja en cada cola solo la capa que está sonando y las que vienen
function podarColas(ev, t = Date.now()) {
  for (const [z, cola] of Object.entries(ev.estado.cola)) {
    let i = 0;
    while (i + 1 < cola.length && cola[i + 1].inicio <= t) i++;
    if (i > 0) { ev.estado.cola[z] = cola.slice(i); ev.estadoTexto = null; }
  }
}

// Envíos ya aplicados, por id (los genera el panel): si la red del operador falla y el panel
// reintenta, el mismo envío no se aplica dos veces.
const enviosRecientes = new Map(); // id → { respuesta, vence }
const MAX_PASOS = 200;
const MAX_DURACION_SECUENCIA_MS = 20 * 60 * 1000;

// POST /api/e/<evento>/escena
//   { id?, asignaciones: [{ zonas: ['G1'] | 'todas', capa: {...} }], adelantoMs }   → un cambio
//   { id?, pasos: [{ enMs, asignaciones }], adelantoMs }                             → una secuencia
//   { id?, cancelar: true }                                → corta lo programado (sigue lo que suena)
// Un cambio nuevo en una zona reemplaza todo lo que estaba programado para después en esa zona.
async function aplicarEscena(ev, req, res) {
  if (!sesionValida(req.headers['x-sesion'], ev)) return json(res, 401, { error: 'Sesión inválida o vencida: vuelve a ingresar la clave' });
  let datos;
  try { datos = JSON.parse(await leerCuerpo(req)); } catch { return json(res, 400, { error: 'JSON inválido' }); }

  const ahora = Date.now();
  for (const [k, v] of enviosRecientes) if (v.vence < ahora) enviosRecientes.delete(k);
  const id = typeof datos.id === 'string' && datos.id.length <= 64 ? `${ev.slug}|${datos.id}` : null;
  if (id && enviosRecientes.has(id)) return json(res, 200, { ...enviosRecientes.get(id).respuesta, repetido: true });

  podarColas(ev, ahora);
  // Los cambios se programan un poco en el futuro para que todos los teléfonos cambien a la vez.
  const adelanto = Math.min(10000, Math.max(0, Number(datos.adelantoMs) || 300));
  const inicio = ahora + adelanto;
  let respuesta;

  if (datos.cancelar) {
    for (const [z, cola] of Object.entries(ev.estado.cola)) {
      ev.estado.cola[z] = cola.filter((c) => c.inicio <= ahora);
    }
    respuesta = { ok: true, cancelado: true };
  } else {
    const pasos = Array.isArray(datos.pasos) ? datos.pasos : Array.isArray(datos.asignaciones) ? [{ enMs: 0, asignaciones: datos.asignaciones }] : null;
    if (!pasos || !pasos.length) return json(res, 400, { error: 'faltan asignaciones o pasos' });
    if (pasos.length > MAX_PASOS) return json(res, 400, { error: `Máximo ${MAX_PASOS} pasos por secuencia` });

    const nuevas = {}; // zona → [capas]
    for (const p of pasos) {
      const en = Math.min(MAX_DURACION_SECUENCIA_MS, Math.max(0, Number(p.enMs) || 0));
      for (const a of Array.isArray(p.asignaciones) ? p.asignaciones : []) {
        const zonas = a.zonas === 'todas' ? ev.zonas : (Array.isArray(a.zonas) ? a.zonas.filter((z) => ev.zonas.includes(z)) : []);
        const capa = nuevaCapa(a.capa || {}, inicio + en); // una capa compartida por todas sus zonas
        for (const z of zonas) (nuevas[z] ||= []).push(capa);
      }
    }
    for (const [z, capas] of Object.entries(nuevas)) {
      capas.sort((a, b) => a.inicio - b.inicio);
      ev.estado.cola[z] = ev.estado.cola[z].filter((c) => c.inicio < inicio).concat(capas);
    }
    const fin = Math.max(...Object.values(nuevas).flat().map((c) => c.inicio), inicio);
    respuesta = { ok: true, inicio, fin, pasos: pasos.length };
  }
  ev.estado.version++;
  ev.estadoTexto = null;
  respuesta.version = ev.estado.version;
  if (id) enviosRecientes.set(id, { respuesta, vence: ahora + 10 * 60 * 1000 });
  difundirEstado(ev);
  json(res, 200, respuesta);
}

function suscribir(ev, req, res, url) {
  const rol = url.searchParams.get('rol') || 'publico';
  // El operador y el simulador ven conteos y ocupación: requieren sesión
  if (OBSERVADORES.has(rol) && !sesionValida(url.searchParams.get('sesion'), ev)) {
    return json(res, 401, { error: 'Sesión inválida o vencida' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const cliente = { res, ev, rol, zona: url.searchParams.get('zona') };
  if (rol === 'publico') cliente.ubicacion = ubicacionDe(ev, url.searchParams);
  clientes.add(cliente);
  res.write(`event: estado
data: ${estadoJson(ev)}

`);
  if (rol === 'operador') enviar(res, 'stats', stats(ev));
  if (OBSERVADORES.has(rol)) enviar(res, 'ocupacion', ocupacion(ev));
  req.on('close', () => clientes.delete(cliente));
}

// /api/e/<evento>/<accion>
function apiEvento(ev, accion, req, res, url) {
  switch (accion) {
    case 'evento': return json(res, 200, { ...ev.def, situacion: situacion(ev.def), requiereClave: requiereClave(ev) });
    case 'recinto':
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' });
      return res.end(ev.json);
    case 'events': return suscribir(ev, req, res, url);
    case 'estado': return responderEstado(ev, req, res, url);
    case 'red': return json(res, 200, { urls: urlsEvento(ev) });
    case 'escena': return req.method === 'POST' ? aplicarEscena(ev, req, res) : json(res, 405, { error: 'Usa POST' });
    case 'aporte': return req.method === 'POST' ? recibirAporte(ev, req, res) : json(res, 405, { error: 'Usa POST' });
    case 'aportes': return verAportes(ev, req, res, url);
    case 'estadisticas': return verEstadisticas(ev, req, res, url);
    default: return json(res, 404, { error: 'No existe' });
  }
}

// Google Analytics 4 (opcional): ID de medición "G-…" en la variable GA4_ID. Sin ella, analitica.js no
// carga nada de Google.
const GA4_ID = /^G-[A-Z0-9]+$/.test(process.env.GA4_ID || '') ? process.env.GA4_ID : '';

function estatico(res, archivo) {
  const ruta = path.join(PUBLIC, archivo);
  if (!ruta.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(ruta, (err, contenido) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    if (archivo === 'analitica.js') contenido = String(contenido).replace('__GA4_ID__', GA4_ID);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(contenido);
  });
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const partes = p.split('/').filter(Boolean);

  // API general
  if (p === '/api/time') return json(res, 200, { t: Date.now() });
  if (p === '/api/eventos') {
    return json(res, 200, [...eventos.values()].filter((e) => !e.def.oculto).map(resumenPublico)
      .sort((a, b) => String(a.fechaISO).localeCompare(String(b.fechaISO))));
  }
  if (p === '/api/login' && req.method === 'POST') return iniciarSesion(req, res);
  if (p === '/api/sesion') {
    const ev = eventos.get(url.searchParams.get('evento'));
    return json(res, 200, { requiereClave: requiereClave(ev), valida: sesionValida(req.headers['x-sesion'], ev) });
  }
  if (p === '/api/logout' && req.method === 'POST') { sesiones.delete(req.headers['x-sesion']); return json(res, 200, { ok: true }); }

  // API de un evento
  if (partes[0] === 'api' && partes[1] === 'e') {
    const ev = eventos.get(partes[2]);
    if (!ev) return json(res, 404, { error: 'Evento no encontrado' });
    return apiEvento(ev, partes[3], req, res, url);
  }
  if (partes[0] === 'api') return json(res, 404, { error: 'No existe' });

  // Páginas
  if (p === '/') return estatico(res, 'eventos.html');
  // Direcciones de antes de los multieventos: /operador, /simulador, /conectar → al evento por defecto
  if (partes.length === 1 && PAGINAS[partes[0]]) return redirigir(res, `/${eventoPorDefecto().slug}/${partes[0]}${url.search}`);
  if (partes.length >= 1 && SLUG.test(partes[0]) && !RESERVADOS.has(partes[0])) {
    const ev = eventos.get(partes[0]);
    if (!ev) return redirigir(res, '/');
    if (partes.length === 1) return estatico(res, 'index.html');
    if (partes.length === 2 && PAGINAS[partes[1]]) return estatico(res, PAGINAS[partes[1]]);
    return redirigir(res, `/${ev.slug}`);
  }
  return estatico(res, p.slice(1));
});

servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nEl puerto ${PORT} está ocupado. ¿Ya hay un servidor abierto? Ciérralo o usa otro puerto: set PORT=3001`);
  else console.error(err);
  process.exit(1);
});

servidor.listen(PORT, '0.0.0.0', () => {
  const ips = ipsLocales();
  const base = ips.length ? urlPublico(ips[0].ip) : `http://localhost:${PORT}/`;
  console.log(`\nPixel Crowd — ${eventos.size} evento(s)`);
  console.log(`  Recintos desde: ${DIRS_RECINTOS.join(' · ')}\n`);
  for (const ev of eventos.values()) {
    const marcas = [situacion(ev.def), ev.def.oculto ? 'oculto' : '', ev.huellaClave ? 'clave propia' : ''].filter(Boolean).join(', ');
    console.log(`  ${ev.def.titulo} (${marcas})`);
    console.log(`    Público:   ${base}${ev.slug}`);
    console.log(`    Operador:  http://localhost:${PORT}/${ev.slug}/operador${requiereClave(ev) ? '  (con clave)' : ''}`);
    console.log(`    QR:        http://localhost:${PORT}/${ev.slug}/conectar\n`);
  }
  console.log(GA4_ID ? `  Google Analytics 4: ${GA4_ID}\n` : '  Google Analytics 4: desactivado (define GA4_ID para activarlo)\n');
  if (!CLAVE_ADMIN) console.log('  ATENCIÓN: no hay clave general. Crea clave-admin.txt o define CLAVE_ADMIN.\n');
  if (!ips.length) console.log('  No se detectó una red local. Conecta el PC a la WiFi y reinicia.\n');
  console.log('  Ctrl+C para detener.\n');
  const ev = eventoPorDefecto();
  if (process.env.ABRIR_NAVEGADOR) abrirNavegador([`http://localhost:${PORT}/${ev.slug}/conectar`, `http://localhost:${PORT}/${ev.slug}/operador`]);
});

function abrirNavegador(urls) {
  const { exec } = require('child_process');
  for (const u of urls) {
    const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
    exec(cmd, () => {});
  }
}
