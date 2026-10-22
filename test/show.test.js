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
  const capa = { id: 1, efecto: 'bandera', velocidad: 0, inicio: 0 };
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
  const capa = { id: 1, efecto: 'bandera', velocidad: 0, inicio: 0 };
  const c = (profundidad, lado) => [...Show.colorEn(capa, Show.posicionDe(recinto, { sector: 'CANCHA', profundidad, lado }), 0)].join(',');
  assert.strictEqual(c('atras', 'der'), '0,57,166'); // la derecha del público es la izquierda de quien mira desde el escenario
  assert.strictEqual(c('atras', 'izq'), '255,255,255');
  assert.strictEqual(c('adelante', 'centro'), '213,43,30');
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
