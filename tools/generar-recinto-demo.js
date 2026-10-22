// Genera un recinto de demostración en data/recintos/demo/ (recinto.json + asientos.csv).
// En un recinto real, asientos.csv se reemplaza por el mapa de numeración digitalizado
// (sector,fila,asiento,x,y en metros, con el escenario en y=0 y x=0 al centro).
const fs = require('fs');
const path = require('path');

const FILAS = 'ABCDEFGHIJKL'.split('');
const SEP_ASIENTO = 0.55;
const SEP_FILA = 0.9;

const recinto = {
  nombre: 'Estadio Demo',
  escenario: { x1: -15, y1: -8, x2: 15, y2: 0 },
  sectores: [
    { id: 'CANCHA', nombre: 'Cancha', tipo: 'general', rect: { x1: -24, y1: 3, x2: 24, y2: 48 } },
    // invertirTexto: el número de asiento crece hacia la izquierda de quien mira el mosaico
    // (desde el escenario o desde la galería de enfrente), así el texto se lee al derecho.
    { id: 'G1', nombre: 'Galería 1', tipo: 'numerada', invertirTexto: true, vistaDesde: 'Galería 2' },
    { id: 'G2', nombre: 'Galería 2', tipo: 'numerada', invertirTexto: false, vistaDesde: 'Galería 1' },
    { id: 'G3', nombre: 'Galería 3', tipo: 'numerada', invertirTexto: true, vistaDesde: 'el escenario' },
  ],
};

const filas = ['sector,fila,asiento,x,y'];
const r2 = (n) => Math.round(n * 100) / 100;

FILAS.forEach((fila, r) => {
  for (let s = 1; s <= 85; s++) {
    const y = 1 + (s - 1) * SEP_ASIENTO;
    filas.push(`G1,${fila},${s},${r2(-28 - r * SEP_FILA)},${r2(y)}`);
    filas.push(`G2,${fila},${s},${r2(28 + r * SEP_FILA)},${r2(y)}`);
  }
  for (let s = 1; s <= 100; s++) {
    filas.push(`G3,${fila},${s},${r2(-27.2 + (s - 1) * SEP_ASIENTO)},${r2(52 + r * SEP_FILA)}`);
  }
});

const dir = path.join(__dirname, '..', 'data', 'recintos', 'demo');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'recinto.json'), JSON.stringify(recinto, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'asientos.csv'), filas.join('\n') + '\n');
console.log(`Recinto demo generado: ${filas.length - 1} asientos numerados.`);
