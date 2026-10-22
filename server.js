// Servidor del prototipo: sin dependencias, solo Node >= 18.
//   /            → web del público
//   /operador    → panel del operador
//   /simulador   → vista del estadio con teléfonos virtuales
// Los teléfonos reciben el estado por Server-Sent Events y calculan sus colores localmente.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const OP_TOKEN = process.env.OP_TOKEN || ''; // si se define, el panel debe enviarlo
const PUBLIC = path.join(__dirname, 'public');
// Recinto a usar: carpeta dentro de data/recintos/ (movistar-arena por defecto, demo para pruebas)
const RECINTO = process.env.RECINTO || 'movistar-arena';
const DATA = path.join(__dirname, 'data', 'recintos', RECINTO);

// ---------- Recinto ----------
function cargarRecinto() {
  const recinto = JSON.parse(fs.readFileSync(path.join(DATA, 'recinto.json'), 'utf8'));
  const porId = Object.fromEntries(recinto.sectores.map((s) => [s.id, s]));
  for (const s of recinto.sectores) if (s.tipo === 'numerada') s.asientos = [];

  const lineas = fs.readFileSync(path.join(DATA, 'asientos.csv'), 'utf8').split(/\r?\n/);
  lineas.slice(1).forEach((linea, i) => {
    if (!linea.trim()) return;
    // col (opcional): columna del asiento en la grilla del sector, vista desde la cancha (para mosaicos)
    const [sector, fila, asiento, x, y, col] = linea.split(',').map((v) => v.trim());
    const s = porId[sector];
    if (!s || s.tipo !== 'numerada') throw new Error(`asientos.csv línea ${i + 2}: sector "${sector}" no existe o no es numerado`);
    const a = [fila, asiento, Number(x), Number(y)];
    if (col !== undefined && col !== '') a.push(Number(col));
    s.asientos.push(a);
  });
  return recinto;
}

const recinto = cargarRecinto();
const ZONAS = recinto.sectores.map((s) => s.id);
const recintoJson = JSON.stringify(recinto);

// ---------- Estado del show ----------
const EFECTOS = ['solido', 'pulso', 'estrobo', 'ola', 'onda', 'arcoiris', 'texto'];
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
    inicio,
  };
}

const estado = { version: 0, capas: {} };
for (const z of ZONAS) estado.capas[z] = nuevaCapa({ efecto: 'pulso', color: '#3a2a80', color2: '#000000', bpm: 30 }, 0);

// ---------- Clientes SSE ----------
const clientes = new Set();

function enviar(res, evento, datos) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
}

function difundirEstado() {
  for (const c of clientes) enviar(c.res, 'estado', estado);
}

function stats() {
  const porZona = Object.fromEntries(ZONAS.map((z) => [z, 0]));
  let publico = 0;
  for (const c of clientes) {
    if (c.rol !== 'publico') continue;
    publico++;
    if (c.zona in porZona) porZona[c.zona]++;
  }
  return { publico, porZona, conexiones: clientes.size };
}

setInterval(() => {
  const s = stats();
  for (const c of clientes) {
    if (c.rol === 'operador') enviar(c.res, 'stats', s);
    else c.res.write(': ping\n\n'); // mantiene viva la conexión a través de proxies
  }
}, 2000);

// ---------- HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const RUTAS = { '/': 'index.html', '/operador': 'operador.html', '/simulador': 'simulador.html', '/conectar': 'conectar.html' };

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

function json(res, codigo, datos) {
  res.writeHead(codigo, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
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

// POST /api/escena  { asignaciones: [{ zonas: ['G1'] | 'todas', capa: {...} }], adelantoMs }
async function aplicarEscena(req, res) {
  if (OP_TOKEN && req.headers['x-token'] !== OP_TOKEN) return json(res, 401, { error: 'token inválido' });
  let datos;
  try { datos = JSON.parse(await leerCuerpo(req)); } catch { return json(res, 400, { error: 'JSON inválido' }); }
  if (!Array.isArray(datos.asignaciones)) return json(res, 400, { error: 'faltan asignaciones' });

  // Los cambios se programan un poco en el futuro para que todos los teléfonos cambien a la vez.
  const adelanto = Math.min(5000, Math.max(0, Number(datos.adelantoMs) || 300));
  const inicio = Date.now() + adelanto;
  for (const a of datos.asignaciones) {
    const zonas = a.zonas === 'todas' ? ZONAS : (Array.isArray(a.zonas) ? a.zonas.filter((z) => ZONAS.includes(z)) : []);
    for (const z of zonas) estado.capas[z] = nuevaCapa(a.capa || {}, inicio);
  }
  estado.version++;
  difundirEstado();
  json(res, 200, { ok: true, version: estado.version, inicio });
}

function eventos(req, res, url) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const cliente = { res, rol: url.searchParams.get('rol') || 'publico', zona: url.searchParams.get('zona') };
  clientes.add(cliente);
  enviar(res, 'estado', estado);
  if (cliente.rol === 'operador') enviar(res, 'stats', stats());
  req.on('close', () => clientes.delete(cliente));
}

function estatico(res, archivo) {
  const ruta = path.join(PUBLIC, archivo);
  if (!ruta.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(ruta, (err, contenido) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(contenido);
  });
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/api/time') return json(res, 200, { t: Date.now() });
  if (p === '/api/recinto') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' }); return res.end(recintoJson); }
  if (p === '/api/events') return eventos(req, res, url);
  if (p === '/api/estado') return json(res, 200, estado);
  if (p === '/api/red') {
    const urls = process.env.URL_PUBLICO ? [process.env.URL_PUBLICO] : ipsLocales().map((i) => urlPublico(i.ip));
    return json(res, 200, { urls });
  }
  if (p === '/api/escena' && req.method === 'POST') return aplicarEscena(req, res);
  if (RUTAS[p]) return estatico(res, RUTAS[p]);
  return estatico(res, p.slice(1));
});

servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nEl puerto ${PORT} está ocupado. ¿Ya hay un servidor abierto? Ciérralo o usa otro puerto: set PORT=3001`);
  else console.error(err);
  process.exit(1);
});

servidor.listen(PORT, '0.0.0.0', () => {
  const ips = ipsLocales();
  console.log(`\nPantallas de concierto — ${recinto.nombre}\n`);
  console.log(`  Operador (en este PC):   http://localhost:${PORT}/operador${OP_TOKEN ? '  (requiere OP_TOKEN)' : ''}`);
  console.log(`  QR para el público:      http://localhost:${PORT}/conectar`);
  console.log(`  Simulador:               http://localhost:${PORT}/simulador\n`);
  if (ips.length) {
    console.log(`  >> Teléfonos (misma WiFi): ${urlPublico(ips[0].ip)}   [${ips[0].nombre}]`);
    for (const i of ips.slice(1)) console.log(`     o también:             ${urlPublico(i.ip)}   [${i.nombre}]`);
  } else {
    console.log('  No se detectó una red local. Conecta el PC a la WiFi y reinicia.');
  }
  console.log('\n  Ctrl+C para detener.\n');
  if (process.env.ABRIR_NAVEGADOR) abrirNavegador([`http://localhost:${PORT}/conectar`, `http://localhost:${PORT}/operador`]);
});

function abrirNavegador(urls) {
  const { exec } = require('child_process');
  for (const u of urls) {
    const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
    exec(cmd, () => {});
  }
}
