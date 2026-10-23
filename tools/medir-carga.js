// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Mide cómo carga la página del público en un teléfono con señal lenta, y si queda guardada para abrir
// sin red. Levanta el servidor de la carpeta indicada, abre Chrome/Edge sin ventana (perfil nuevo, como
// un teléfono que entra por primera vez) y usa el protocolo de DevTools para limitar la red.
//
//   node tools/medir-carga.js --evento babymetal-2026 [--servidor .] [--red lenta|normal] [--repeticiones 3]
//
// Primera visita: cuándo aparece el texto, cuándo aparece el mapa para elegir sector, cuánto se descargó.
// Segunda visita: con el servidor apagado (sin red para la app), ¿abre la página y el mapa desde lo guardado?
// Sin dependencias: usa el WebSocket que trae Node 22.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const EVENTO = args.evento || 'demo';
const SERVIDOR = path.resolve(args.servidor || path.join(__dirname, '..'));
const PUERTO = Number(args.puerto || 3090);
const REPETICIONES = Number(args.repeticiones || 1);
// "Slow 3G" de DevTools: 400 kbit/s y 400 ms de latencia (más lenta que el 3G típico de un recinto lleno)
const REDES = {
  lenta: { latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 },
  normal: { latency: 40, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8 },
};
const RED = REDES[args.red || 'lenta'];
const NAVEGADORES = [
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function levantarServidor() {
  const env = {
    ...process.env, PORT: String(PUERTO), CLAVE_ADMIN: 'medicion', GA4_ID: args.ga4 || 'G-MEDICION1',
    DATA_APORTES: fs.mkdtempSync(path.join(os.tmpdir(), 'pc-med-ap-')),
    DATA_ESTADISTICAS: fs.mkdtempSync(path.join(os.tmpdir(), 'pc-med-est-')),
  };
  const proc = spawn(process.execPath, [path.join(SERVIDOR, 'server.js')], { cwd: SERVIDOR, env });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('Ctrl+C') && resolve(proc));
    proc.on('exit', (c) => reject(new Error('el servidor terminó con código ' + c)));
  });
}

async function abrirNavegador() {
  const ejecutable = NAVEGADORES.find((n) => fs.existsSync(n));
  if (!ejecutable) throw new Error('No encontré Chrome ni Edge');
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-med-perfil-'));
  const proc = spawn(ejecutable, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${perfil}`,
    '--no-first-run', '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const lista = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const pagina = lista.find((t) => t.type === 'page');
      if (pagina) return { proc, perfil, ws: pagina.webSocketDebuggerUrl };
    } catch { /* aún no abre */ }
    await pausa(200);
  }
  throw new Error('El navegador no abrió el puerto de depuración');
}

function conectarCDP(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pendientes = new Map();
  const oyentes = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id); }
    else if (d.method) for (const o of oyentes) o(d);
  };
  const cdp = {
    enviar: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const n = ++id;
      pendientes.set(n, (d) => (d.error ? reject(new Error(d.error.message)) : resolve(d.result)));
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    }),
    on: (f) => oyentes.push(f),
    evaluar: async (expr) => (await cdp.enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value,
    cerrar: () => ws.close(),
  };
  return new Promise((resolve) => { ws.onopen = () => resolve(cdp); });
}

// Abre la página y espera hasta que aparece el mapa (la leyenda se llena justo antes de dibujarlo)
async function visitar(cdp, red, { esperarQuieto }) {
  const pedidos = new Map(); // requestId → url
  let bytes = 0, fallidos = 0, enCurso = 0, ultimoMovimiento = Date.now();
  const porDominio = {};
  let activo = true; // cada visita cuenta solo lo suyo
  cdp.on((d) => {
    if (!activo) return;
    if (d.method === 'Network.requestWillBeSent') { pedidos.set(d.params.requestId, d.params.request.url); enCurso++; ultimoMovimiento = Date.now(); }
    if (d.method === 'Network.loadingFinished') {
      bytes += d.params.encodedDataLength; enCurso--; ultimoMovimiento = Date.now();
      const host = new URL(pedidos.get(d.params.requestId) || 'http://x').hostname;
      porDominio[host] = (porDominio[host] || 0) + d.params.encodedDataLength;
    }
    if (d.method === 'Network.loadingFailed') { fallidos++; enCurso--; ultimoMovimiento = Date.now(); }
  });
  await cdp.enviar('Network.emulateNetworkConditions', { offline: false, ...red });
  await cdp.enviar('Page.navigate', { url: `http://localhost:${PUERTO}/${EVENTO}` });
  const inicio = Date.now();
  let mapa = null, texto = null;
  while (Date.now() - inicio < 60000) {
    const m = await cdp.evaluar(`(() => ({
      t: performance.now(),
      texto: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      mapa: (document.getElementById('leyenda')?.innerHTML.length || 0) > 0,
    }))()`).catch(() => null);
    if (m) { texto = m.texto; if (m.mapa) { mapa = m.t; break; } }
    await pausa(100);
  }
  // Se deja terminar lo que siga bajando (Analytics, guardado del service worker) para contar todo
  if (esperarQuieto) {
    const limite = Date.now() + 40000;
    while (Date.now() < limite && (enCurso > 0 || Date.now() - ultimoMovimiento < 3000)) await pausa(200);
  }
  activo = false;
  return { texto, mapa, bytes, pedidos: pedidos.size, fallidos, porDominio };
}

const kb = (b) => `${Math.round(b / 1024)} KB`;
const seg = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

(async () => {
  const resultados = [];
  for (let r = 0; r < REPETICIONES; r++) {
    const servidor = await levantarServidor();
    const nav = await abrirNavegador();
    const cdp = await conectarCDP(nav.ws);
    try {
      await cdp.enviar('Network.enable');
      await cdp.enviar('Page.enable');
      // También se cuenta lo que descarga el service worker (fuentes, archivos que guarda): es tráfico real
      cdp.on((d) => {
        if (d.method === 'Target.attachedToTarget' && d.params.targetInfo.type === 'service_worker') {
          cdp.enviar('Network.enable', {}, d.params.sessionId).catch(() => {});
          cdp.enviar('Runtime.runIfWaitingForDebugger', {}, d.params.sessionId).catch(() => {});
        }
      });
      await cdp.enviar('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      await cdp.enviar('Network.setCacheDisabled', { cacheDisabled: false });
      const primera = await visitar(cdp, RED, { esperarQuieto: true });
      const guardado = await cdp.evaluar(`(async () => {
        const lista = [];
        for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) lista.push(new URL(r.url).pathname);
        return lista.filter((p) => !p.startsWith('/s/')); // sin los archivos de fuentes
      })()`);
      // Segunda visita sin red para la app: se apaga el servidor y se recarga con la misma red lenta
      servidor.kill();
      await pausa(500);
      const segunda = await visitar(cdp, RED, { esperarQuieto: false });
      resultados.push({ primera, guardado, segunda });
      console.log(`Corrida ${r + 1}: texto ${seg(primera.texto)} · mapa ${seg(primera.mapa)} · ${kb(primera.bytes)} en ${primera.pedidos} pedidos` +
        ` (${primera.fallidos} fallidos) · sin red: mapa ${segunda.mapa ? seg(segunda.mapa) : 'NO aparece'}`);
    } finally {
      cdp.cerrar();
      nav.proc.kill();
      servidor.kill();
      await pausa(1000);
    }
  }
  const mediana = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const p = resultados.map((x) => x.primera);
  console.log(`\nRed: ${args.red || 'lenta'} (${RED.latency} ms, ${Math.round(RED.downloadThroughput * 8 / 1024)} kbit/s) · evento ${EVENTO} · ${REPETICIONES} corrida(s), medianas:`);
  console.log(`  Texto visible:          ${seg(mediana(p.map((x) => x.texto)))}`);
  console.log(`  Mapa para elegir:       ${seg(mediana(p.map((x) => x.mapa)))}`);
  console.log(`  Descargado (con Analytics y fuentes): ${kb(mediana(p.map((x) => x.bytes)))} en ${mediana(p.map((x) => x.pedidos))} pedidos`);
  console.log(`  Por dominio (1ª corrida): ${Object.entries(p[0].porDominio).map(([h, b]) => `${h} ${kb(b)}`).join(' · ')}`);
  console.log(`  Guardado tras 1 visita: ${resultados[0].guardado.join(', ') || '(nada)'}`);
  console.log(`  2ª visita sin red: mapa ${resultados.every((x) => x.segunda.mapa) ? 'aparece en ' + seg(mediana(resultados.map((x) => x.segunda.mapa))) : 'NO aparece'}`);
  process.exit(0);
})().catch((e) => { console.error('La medición se detuvo:', e.message); process.exit(1); });
