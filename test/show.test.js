// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Carga public/show.js como lo haría el navegador, con un window falso.
function cargarShow() {
  const ctx = { window: {}, Date, Math, Map, Set, JSON, String, Number, Object, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'show.js'), 'utf8'), ctx);
  return ctx.window.Show;
}

function recintoDemo(Show) {
  const recinto = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recintos', 'demo', 'recinto.json'), 'utf8'));
  const porId = Object.fromEntries(recinto.sectores.map((s) => [s.id, s]));
  for (const s of recinto.sectores) if (s.tipo === 'numerada') s.asientos = [];
  fs.readFileSync(path.join(__dirname, '..', 'data', 'recintos', 'demo', 'asientos.csv'), 'utf8').trim().split('\n').slice(1).forEach((l) => {
    const [sec, fila, asiento, x, y] = l.split(',');
    porId[sec].asientos.push([fila, asiento, +x, +y]);
  });
  return Show.prepararRecinto(recinto);
}

const Show = cargarShow();
const recinto = recintoDemo(Show);

// El mapa del Caupolicán vive en el repositorio privado de recintos (clonado al lado de este o en
// RECINTOS_DIR); en una copia pública del código este test se omite.
const RUTA_CAUPOLICAN = [
  ...(process.env.RECINTOS_DIR || '').split(path.delimiter).filter(Boolean),
  path.join(__dirname, '..', '..', 'pixel-crowd-recintos', 'recintos'),
].map((d) => path.join(d, 'teatro-caupolican', 'recinto.json')).find((f) => fs.existsSync(f));

test('Teatro Caupolicán: 18 zonas con forma propia, 9 celdas parejas y graderías bien orientadas', { skip: !RUTA_CAUPOLICAN && 'sin el repositorio privado de recintos' }, () => {
  const S = cargarShow(); // instancia aparte: prepararRecinto guarda tablas por recinto
  const t = S.prepararRecinto(JSON.parse(fs.readFileSync(RUTA_CAUPOLICAN, 'utf8')));
  assert.strictEqual(t.sectores.length, 18);
  for (const s of t.sectores) {
    assert.strictEqual(s.tipo, 'general', s.id);
    assert.strictEqual(Object.keys(s.subzonas).length, 9, s.id);
    // Celdas repartidas por cantidad de puntos: ninguna con menos de la mitad del promedio
    const conteo = Array(9).fill(0);
    for (const q of s.puntos) conteo[q[2]]++;
    const prom = s.puntos.length / 9;
    assert.ok(Math.min(...conteo) >= prom / 2, `${s.id}: ${conteo}`);
  }
  // En una gradería, las filas de abajo quedan más cerca de la cancha que las de arriba
  const cancha = t.porId['CANCHA-TI'];
  const cx = cancha.rect.x2, cy = cancha.rect.y1; // esquina central de la cancha
  const fondo = t.porId['PA-F'];
  const d = (k) => Math.hypot(fondo.subzonas[k].x - cx, fondo.subzonas[k].y - cy);
  assert.ok(d('adelante-centro') < d('atras-centro'));
  // Platea Alta se ve más arriba desde el escenario que la cancha
  const pos = (sector, profundidad, lado) => S.posicionDe(t, { sector, profundidad, lado });
  assert.ok(pos('PA-F', 'atras', 'centro').vista.v < pos('CANCHA-AI', 'adelante', 'centro').vista.v);
});

test('posición de un asiento numerado usa sus coordenadas exactas y su grilla', () => {
  const p = Show.posicionDe(recinto, { sector: 'G3', fila: 'A', asiento: '1' });
  assert.strictEqual(p.zona, 'G3');
  assert.strictEqual(p.x, -27.2);
  assert.strictEqual(p.y, 52);
  assert.strictEqual(p.grid.row, 0);
  assert.strictEqual(p.grid.col, 99); // G3 invierte el texto: el asiento 1 queda a la derecha de quien mira
});

test('posición declarada en cancha cae en el centro de su subzona', () => {
  const p = Show.posicionDe(recinto, { sector: 'CANCHA', profundidad: 'adelante', lado: 'izq' });
  assert.strictEqual(p.grid, null);
  assert.ok(p.x < -8 && p.y < 18, `esperaba adelante-izquierda, obtuve ${p.x},${p.y}`);
});

test('ubicación inexistente devuelve null', () => {
  assert.strictEqual(Show.posicionDe(recinto, { sector: 'G1', fila: 'Z', asiento: '1' }), null);
  assert.strictEqual(Show.posicionDe(recinto, { sector: 'NOPE' }), null);
});

test('dos teléfonos con la misma capa y hora dan el mismo color (sincronía determinista)', () => {
  const capa = { id: 1, efecto: 'ola', color: '#00ff00', color2: '#000000', velocidad: 20, angulo: 0, inicio: 1000 };
  const pos = Show.posicionDe(recinto, { sector: 'G2', fila: 'C', asiento: '40' });
  assert.deepStrictEqual(Show.colorEn(capa, pos, 5432), Show.colorEn(capa, pos, 5432));
});

test('la ola avanza: el frente pasa por distintos asientos en distintos momentos', () => {
  const capa = { id: 1, efecto: 'ola', color: '#ffffff', color2: '#000000', velocidad: 20, angulo: 90, inicio: 0 };
  const cerca = Show.posicionDe(recinto, { sector: 'G1', fila: 'A', asiento: '21' }); // y = 12
  const lejos = Show.posicionDe(recinto, { sector: 'G1', fila: 'A', asiento: '85' }); // y = 47.2
  const brillo = (pos, t) => Show.colorEn(capa, pos, t)[0];
  // A los 0.3 s la banda cubre y = 6..18; a los 2 s cubre y = 40..52
  assert.ok(brillo(cerca, 300) > 200);
  assert.ok(brillo(lejos, 300) < 10);
  assert.ok(brillo(cerca, 2000) < 10);
  assert.ok(brillo(lejos, 2000) > 200);
});

test('estrobo nunca supera 3 Hz aunque se pida más', () => {
  const capa = { id: 1, efecto: 'estrobo', color: '#ffffff', color2: '#000000', hz: 50, inicio: 0 };
  const pos = { x: 0, y: 0, grid: null };
  let cambios = 0;
  let prev = Show.colorEn(capa, pos, 0)[0];
  for (let t = 1; t <= 1000; t++) {
    const c = Show.colorEn(capa, pos, t)[0];
    if (c !== prev) cambios++;
    prev = c;
  }
  assert.ok(cambios <= 6, `hubo ${cambios} cambios en 1 s`); // 3 Hz = 6 transiciones
});

test('el texto fijo dibuja letras solo en galerías numeradas', () => {
  const capa = { id: 1, efecto: 'texto', color: '#ffffff', color2: '#000000', velocidad: 0, texto: 'I', inicio: 0 };
  const s = recinto.porId.G2; // G2 no invierte
  // Cuenta los asientos encendidos de G2: una "I" de 5x7 tiene 3+5+3 = 11 píxeles
  let encendidos = 0;
  for (const a of s.mapa.values()) if (Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, 0)[0] === 255) encendidos++;
  assert.strictEqual(encendidos, 11);
  const cancha = Show.posicionDe(recinto, { sector: 'CANCHA', profundidad: 'medio', lado: 'centro' });
  assert.deepStrictEqual([...Show.colorEn(capa, cancha, 0)], [0, 0, 0]);
});

test('bandera de Chile en una galería: cantón azul con estrella blanca, franja blanca arriba y roja abajo', () => {
  const capa = { id: 1, efecto: 'bandera', modo: 'sector', velocidad: 0, inicio: 0 };
  const s = recinto.porId.G3;
  const color = (col, rowDesdeArriba) => {
    const a = [...s.mapa.values()].find((x) => x.grid.col === col && x.grid.rows - 1 - x.grid.row === rowDesdeArriba);
    return [...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, 0)].map(Math.round).join(',');
  };
  assert.strictEqual(color(1, 0), '0,57,166'); // esquina del cantón: azul
  assert.strictEqual(color(16, 2), '255,255,255'); // centro del cantón: estrella blanca
  assert.strictEqual(color(80, 1), '255,255,255'); // franja superior derecha: blanca
  assert.strictEqual(color(10, 11), '213,43,30'); // fila de abajo: roja
});

test('bandera en la cancha: vista desde el escenario, el fondo es la parte de arriba', () => {
  const capa = { id: 1, efecto: 'bandera', modo: 'sector', velocidad: 0, inicio: 0 };
  const c = (profundidad, lado) => [...Show.colorEn(capa, Show.posicionDe(recinto, { sector: 'CANCHA', profundidad, lado }), 0)].join(',');
  assert.strictEqual(c('atras', 'der'), '0,57,166'); // la derecha del público es la izquierda de quien mira desde el escenario
  assert.strictEqual(c('atras', 'izq'), '255,255,255');
  assert.strictEqual(c('adelante', 'centro'), '213,43,30');
});

test('bandera completa: todo el público forma una sola bandera, repartida por cantidad de gente', () => {
  const capa = { id: 1, efecto: 'bandera', modo: 'completa', velocidad: 0, inicio: 0 };
  const peso = { rojo: 0, azul: 0, blanco: 0 };
  const sumar = (c, w) => { const k = [...c].map(Math.round).join(','); peso[k === '213,43,30' ? 'rojo' : k === '0,57,166' ? 'azul' : 'blanco'] += w; };
  for (const s of recinto.sectores) {
    if (s.tipo === 'numerada') for (const a of s.mapa.values()) sumar(Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid, vista: a.vista }, 0), 1);
    else {
      const area = (s.rect.x2 - s.rect.x1) * (s.rect.y2 - s.rect.y1) / 9;
      for (const c of Object.values(s.subzonas)) sumar(Show.colorEn(capa, { x: c.x, y: c.y, grid: null, vista: c.vista }, 0), area * 2);
    }
  }
  const total = peso.rojo + peso.azul + peso.blanco;
  // Mitad roja, y en la mitad de arriba un tercio de cantón azul liso (sin estrella en la bandera grande)
  assert.ok(Math.abs(peso.rojo / total - 0.5) < 0.12, `rojo ${(peso.rojo / total).toFixed(2)}`);
  assert.ok(peso.azul / total > 0.1 && peso.azul / total < 0.22, `azul ${(peso.azul / total).toFixed(2)}`);
  // Ningún asiento del cantón queda blanco
  for (const s of recinto.sectores) if (s.tipo === 'numerada') for (const a of s.mapa.values()) {
    if (a.vista.u < 1 / 3 && a.vista.v < 0.5) {
      assert.strictEqual([...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid, vista: a.vista }, 0)].join(','), '0,57,166');
    }
  }
});

test('bandera completa: arriba la gente más alta y lejana, abajo la cancha cercana al escenario', () => {
  const capa = { id: 1, efecto: 'bandera', modo: 'completa', velocidad: 0, inicio: 0 };
  const cerca = Show.posicionDe(recinto, { sector: 'CANCHA', profundidad: 'adelante', lado: 'centro' });
  assert.strictEqual([...Show.colorEn(capa, cerca, 0)].join(','), '213,43,30');
  // Última fila de la galería del fondo: entre lo más alto que se ve desde el escenario
  const g3 = recinto.porId.G3;
  const arriba = [...g3.mapa.values()].find((a) => a.grid.row === g3.rows - 1 && a.grid.col === Math.floor(g3.cols / 2));
  assert.ok(arriba.vista.v < 0.25, `v=${arriba.vista.v}`);
});

test('bandera flameando: el asta queda fija, la tela ondula y nadie parpadea más de 3 veces por segundo', () => {
  const capa = { id: 1, efecto: 'bandera', modo: 'sector', velocidad: 40, inicio: 0 };
  const s = recinto.porId.G2;
  const enCol = (col, rowDesdeArriba) => [...s.mapa.values()].find((a) => a.grid.col === col && a.grid.rows - 1 - a.grid.row === rowDesdeArriba);
  const asta = enCol(0, 9), punta = enCol(s.cols - 1, 0);
  const tono = (a, t) => [...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, t)].map(Math.round);
  // Junto al asta el color base no cambia (siempre rojo, solo varía la luz)
  for (let t = 0; t < 3000; t += 100) { const [r, g, b] = tono(asta, t); assert.ok(r > g && r > b, `asta ${r},${g},${b}`); }
  // En la punta superior la tela flamea: a veces se sale (apagado) y a veces vuelve
  const apagados = Array.from({ length: 60 }, (_, i) => tono(punta, i * 50)).filter((c) => c.join(',') === '0,0,0').length;
  assert.ok(apagados > 0 && apagados < 60, `apagados ${apagados}/60`);
  // Cambios de encendido/apagado en la punta: lentos (≤ 3 por segundo)
  let cambios = 0, prev = null;
  for (let t = 0; t <= 1000; t += 10) { const off = tono(punta, t).join(',') === '0,0,0'; if (prev !== null && off !== prev) cambios++; prev = off; }
  assert.ok(cambios <= 6, `cambios ${cambios}`);
});

test('tela al viento: solo tonos del color elegido, con valles oscuros y crestas claras', () => {
  const capa = { id: 1, efecto: 'tela', modo: 'completa', color: '#e60012', color2: '#000000', velocidad: 30, inicio: 0 };
  const s = recinto.porId.G2;
  let min = 1, max = 0, tonos = 0;
  for (const a of s.mapa.values()) {
    const [r, g, b] = [...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid, vista: a.vista }, 1234)];
    if (r === 0 && g === 0 && b === 0) continue; // borde fuera de la tela
    tonos++;
    // Siempre el mismo matiz: el rojo domina; el brillo de las crestas solo aclara un poco (sin volverse blanco)
    assert.ok(r >= g && r >= b && r - Math.max(g, b) > 40, `tono ${r},${g},${b}`);
    min = Math.min(min, r / 230); max = Math.max(max, r / 230);
  }
  assert.ok(tonos > 100);
  assert.ok(max - min > 0.4, `contraste entre valles y crestas ${min.toFixed(2)}–${max.toFixed(2)}`);
});

test('tela quieta (viento 0): color pleno y parejo', () => {
  const capa = { id: 1, efecto: 'tela', modo: 'sector', color: '#2d7bff', velocidad: 0, inicio: 0 };
  const a = [...recinto.porId.G1.mapa.values()][50];
  assert.strictEqual([...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid, vista: a.vista }, 5000)].map(Math.round).join(','), '45,123,255');
});

test('bandera de Japón: círculo rojo al centro sobre blanco', () => {
  const capa = { id: 1, efecto: 'bandera', pais: 'japon', modo: 'sector', velocidad: 0, inicio: 0 };
  const s = recinto.porId.G2;
  const color = (col, rowDesdeArriba) => {
    const a = [...s.mapa.values()].find((x) => x.grid.col === col && x.grid.rows - 1 - x.grid.row === rowDesdeArriba);
    return [...Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, 0)].map(Math.round).join(',');
  };
  assert.strictEqual(color(Math.floor(s.cols / 2), Math.floor(s.rows / 2)), '188,0,45'); // centro: rojo
  assert.strictEqual(color(2, 0), '255,255,255'); // esquina: blanco
  // El rojo ocupa cerca de π·0,3²/1,5 ≈ 19 % de la bandera
  let rojos = 0, total = 0;
  for (const a of s.mapa.values()) { total++; if (Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, 0)[1] === 0) rojos++; }
  assert.ok(rojos / total > 0.12 && rojos / total < 0.26, `rojo ${(rojos / total).toFixed(2)}`);
});

test('el glifo de zorro se dibuja en los mosaicos', () => {
  const capa = { id: 1, efecto: 'texto', color: '#ffffff', color2: '#000000', velocidad: 0, texto: '🦊', inicio: 0 };
  let encendidos = 0;
  for (const a of recinto.porId.G2.mapa.values()) if (Show.colorEn(capa, { x: a.x, y: a.y, grid: a.grid }, 0)[0] === 255) encendidos++;
  assert.strictEqual(encendidos, 2 + 4 + 5 + 3 + 5 + 3 + 1); // píxeles del glifo 5x7
});

test('el pulso tampoco supera 3 ciclos por segundo aunque se pida un BPM alto', () => {
  const capa = { id: 1, efecto: 'pulso', color: '#ffffff', color2: '#000000', bpm: 600, inicio: 0 };
  const pos = { x: 0, y: 0, grid: null };
  // Con 3 Hz, a los 1/6 s el pulso está en su mínimo (negro); con 10 Hz estaría cerca del máximo
  assert.ok(Show.colorEn(capa, pos, 1000 / 6)[0] < 1);
});

test('el reproductor mantiene la capa anterior hasta el inicio programado', () => {
  const r = Show.crearReproductor();
  r.actualizar({ capas: { G1: { id: 1, efecto: 'solido', color: '#ff0000', inicio: 0 } } });
  const futuro = Date.now() + 60000;
  r.actualizar({ capas: { G1: { id: 2, efecto: 'solido', color: '#0000ff', inicio: futuro } } });
  assert.strictEqual(r.capa('G1', futuro - 1).id, 1);
  assert.strictEqual(r.capa('G1', futuro).id, 2);
});
