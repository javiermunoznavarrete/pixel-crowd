// Motor compartido (público, operador y simulador).
// Cada teléfono calcula su color localmente a partir de: la capa activa de su zona,
// su posición y la hora sincronizada con el servidor. Así no se envían mensajes por frame
// y el show sigue corriendo aunque la red se caiga.
(function () {
  'use strict';

  const MAX_HZ_ESTROBO = 3; // límite por seguridad fotosensible

  // ---------- Reloj sincronizado (estilo NTP) ----------
  const reloj = { offset: 0, rtt: null };

  async function sincronizarReloj(muestras = 6) {
    let mejor = null;
    for (let i = 0; i < muestras; i++) {
      try {
        const t0 = Date.now();
        const r = await fetch('/api/time', { cache: 'no-store' });
        const { t } = await r.json();
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (!mejor || rtt < mejor.rtt) mejor = { rtt, offset: t + rtt / 2 - t1 };
      } catch (e) { /* reintenta en la siguiente muestra */ }
    }
    if (mejor) { reloj.offset = mejor.offset; reloj.rtt = mejor.rtt; }
    return mejor;
  }

  const ahora = () => Date.now() + reloj.offset;

  // ---------- Recinto ----------
  // Agrega a cada sector numerado su grilla (fila/columna por asiento) y a cada sector
  // general sus 9 subzonas (adelante/medio/atrás × izquierda/centro/derecha).
  function prepararRecinto(recinto) {
    for (const s of recinto.sectores) {
      if (s.tipo === 'numerada') {
        const porFila = new Map();
        for (const [fila, asiento, x, y, colMapa] of s.asientos) {
          if (!porFila.has(fila)) porFila.set(fila, []);
          porFila.get(fila).push({ fila, asiento, x, y, colMapa });
        }
        s.filas = [...porFila.keys()];
        s.rows = s.filas.length;
        // Si el mapa trae la columna real de cada asiento (con pasillos), se usa tal cual;
        // si no, se arma la grilla ordenando por número de asiento y centrando cada fila.
        const conColumna = s.asientos.length && s.asientos.every((a) => a[4] !== undefined);
        s.cols = conColumna
          ? Math.max(...s.asientos.map((a) => a[4])) + 1
          : Math.max(...[...porFila.values()].map((a) => a.length));
        s.mapa = new Map();
        s.filas.forEach((fila, row) => {
          const lista = porFila.get(fila).sort((a, b) => cmpAsiento(a.asiento, b.asiento));
          const margen = Math.floor((s.cols - lista.length) / 2);
          lista.forEach((a, i) => {
            const col = conColumna ? a.colMapa : margen + i;
            a.grid = { row, col: s.invertirTexto ? s.cols - 1 - col : col, rows: s.rows, cols: s.cols };
            s.mapa.set(clave(fila, a.asiento), a);
          });
        });
        s.asientosDeFila = (fila) => porFila.get(fila).map((a) => a.asiento);
      } else {
        const { x1, y1, x2, y2 } = s.rect;
        s.subzonas = {};
        PROFUNDIDADES.forEach((p, iy) => LADOS.forEach((l, ix) => {
          s.subzonas[p.id + '-' + l.id] = {
            x: x1 + (x2 - x1) * (ix + 0.5) / 3,
            y: y1 + (y2 - y1) * (iy + 0.5) / 3,
          };
        }));
      }
    }
    recinto.porId = Object.fromEntries(recinto.sectores.map((s) => [s.id, s]));

    // Zonas generales del mismo grupo (p. ej. los 4 cuadrantes de la cancha) se tratan como una sola superficie
    const grupos = {};
    for (const s of recinto.sectores) {
      if (!s.rect) continue;
      const g = s.grupo || s.id;
      const r = grupos[g];
      grupos[g] = r ? { x1: Math.min(r.x1, s.rect.x1), y1: Math.min(r.y1, s.rect.y1), x2: Math.max(r.x2, s.rect.x2), y2: Math.max(r.y2, s.rect.y2) } : { ...s.rect };
    }
    for (const s of recinto.sectores) if (s.rect) s.rectGrupo = grupos[s.grupo || s.id];

    prepararVista(recinto);
    return recinto;
  }

  // ---------- Vista desde el escenario ----------
  // Para efectos que usan a todo el público como una sola imagen (p. ej. la bandera completa), cada
  // posición se proyecta como la ve alguien en el escenario: ángulo horizontal y ángulo de elevación.
  // La altura de cada asiento se estima por nivel y fila. Luego cada eje se reparte por cantidad de
  // gente (cuantiles): así la mitad superior de la imagen la forma la mitad del público que se ve más arriba.
  const OJO = { y: -3, z: 3 }; // centro del escenario, a 3 m de altura
  const ALTURA_BASE = { 'Platea Baja': 1.5, 'Platea Alta': 9, Tribuna: 15 };
  const SUBIDA_FILA = 0.45; // metros que sube cada fila
  const ALTURA_CANCHA = 1.6; // teléfonos en alto en la cancha
  const PERSONAS_M2_CANCHA = 2; // densidad estimada de gente de pie

  function vistaCruda(x, y, z) {
    const d = Math.hypot(x, y - OJO.y);
    // u crece hacia la derecha de quien mira desde el escenario (que es la izquierda del mapa: x negativo)
    return { u: -Math.atan2(x, y - OJO.y), v: -Math.atan2(z - OJO.z, d) };
  }

  function prepararVista(recinto) {
    const muestras = []; // { u, v, w }
    const conVista = []; // objetos a los que asignar .vista
    for (const s of recinto.sectores) {
      if (s.tipo === 'numerada') {
        const base = ALTURA_BASE[s.nivel] ?? 2;
        for (const a of s.mapa.values()) {
          a.vistaCruda = vistaCruda(a.x, a.y, base + a.grid.row * SUBIDA_FILA);
          muestras.push({ ...a.vistaCruda, w: 1 });
          conVista.push(a);
        }
      } else {
        const area = (s.rect.x2 - s.rect.x1) * (s.rect.y2 - s.rect.y1) / 9;
        for (const c of Object.values(s.subzonas)) {
          c.vistaCruda = vistaCruda(c.x, c.y, ALTURA_CANCHA);
          muestras.push({ ...c.vistaCruda, w: area * PERSONAS_M2_CANCHA });
          conVista.push(c);
        }
      }
    }
    const tabla = (eje) => {
      const orden = muestras.map((m) => ({ val: m[eje], w: m.w })).sort((a, b) => a.val - b.val);
      const total = orden.reduce((t, m) => t + m.w, 0);
      let acum = 0;
      return orden.map((m) => { const c = (acum + m.w / 2) / total; acum += m.w; return { val: m.val, c }; });
    };
    recinto.vista = { u: tabla('u'), v: tabla('v') };
    for (const o of conVista) o.vista = normalizarVista(recinto, o.vistaCruda);
  }

  // Fracción del público (0..1) que queda antes de este valor en el eje
  function cuantil(tabla, val) {
    if (!tabla.length) return 0.5;
    let lo = 0, hi = tabla.length - 1;
    if (val <= tabla[0].val) return tabla[0].c;
    if (val >= tabla[hi].val) return tabla[hi].c;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tabla[m].val <= val) lo = m; else hi = m; }
    const a = tabla[lo], b = tabla[hi];
    return a.c + (b.c - a.c) * ((val - a.val) / (b.val - a.val || 1));
  }
  const normalizarVista = (recinto, cruda) => ({ u: cuantil(recinto.vista.u, cruda.u), v: cuantil(recinto.vista.v, cruda.v) });

  // Vista para una posición arbitraria (el simulador la usa para la posición real en la cancha)
  function vistaEn(recinto, x, y, z = ALTURA_CANCHA) { return normalizarVista(recinto, vistaCruda(x, y, z)); }

  const PROFUNDIDADES = [
    { id: 'adelante', nombre: 'Adelante' }, { id: 'medio', nombre: 'Al medio' }, { id: 'atras', nombre: 'Atrás' },
  ];
  // Lados vistos desde el público mirando al escenario (en el mapa el escenario queda arriba,
  // así que la izquierda del público coincide con la izquierda del mapa).
  const LADOS = [
    { id: 'izq', nombre: 'Izquierda' }, { id: 'centro', nombre: 'Centro' }, { id: 'der', nombre: 'Derecha' },
  ];

  const clave = (fila, asiento) => fila + '|' + asiento;
  const cmpAsiento = (a, b) => (parseFloat(a) - parseFloat(b)) || String(a).localeCompare(String(b));

  // ubicacion: { sector, fila, asiento } (numerada) o { sector, profundidad, lado } (general)
  function posicionDe(recinto, ubicacion) {
    const s = ubicacion && recinto.porId[ubicacion.sector];
    if (!s) return null;
    if (s.tipo === 'numerada') {
      const a = s.mapa.get(clave(ubicacion.fila, ubicacion.asiento));
      return a ? { zona: s.id, x: a.x, y: a.y, grid: a.grid, vista: a.vista } : null;
    }
    const c = s.subzonas[ubicacion.profundidad + '-' + ubicacion.lado];
    return c ? { zona: s.id, x: c.x, y: c.y, grid: null, rel: relEnRect(s.rectGrupo || s.rect, c.x, c.y), vista: c.vista } : null;
  }

  // Posición relativa (0..1) dentro del rectángulo de una zona general (o de su grupo), en el plano (u: izq→der, v: escenario→fondo)
  function relEnRect(r, x, y) {
    return { u: (x - r.x1) / (r.x2 - r.x1), v: (y - r.y1) / (r.y2 - r.y1) };
  }

  // ---------- Fuente 5x7 para mosaicos de texto ----------
  const FUENTE = {
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
    D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
    G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
    J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
    M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], 'Ñ': [14, 0, 17, 25, 21, 19, 17],
    O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13],
    R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
    U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10],
    X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
    0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
    3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
    6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
    9: [14, 17, 17, 15, 1, 2, 12], ' ': [0, 0, 0, 0, 0, 0, 0], '!': [4, 4, 4, 4, 4, 0, 4],
    '?': [14, 17, 1, 2, 4, 0, 4], '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 31, 0, 0, 0],
    '♥': [0, 10, 31, 31, 14, 4, 0], '*': [0, 4, 21, 14, 21, 4, 0],
    '🦊': [17, 27, 31, 21, 31, 14, 4], // cabeza de zorro (Fox God de BABYMETAL)
  };

  // Convierte el texto en columnas de 7 bits (bit 6 = fila superior).
  const cacheTexto = new Map();
  function columnasTexto(texto) {
    if (cacheTexto.has(texto)) return cacheTexto.get(texto);
    const limpio = texto.toUpperCase().replace(/Ñ/g, '\u0001').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'Ñ');
    const cols = [];
    for (const ch of limpio) {
      const g = FUENTE[ch] || FUENTE[' '];
      for (let c = 0; c < 5; c++) {
        let m = 0;
        for (let r = 0; r < 7; r++) if (g[r] & (1 << (4 - c))) m |= 1 << (6 - r);
        cols.push(m);
      }
      cols.push(0);
    }
    if (cacheTexto.size > 50) cacheTexto.clear();
    cacheTexto.set(texto, cols);
    return cols;
  }

  // ---------- Efectos ----------
  const EFECTOS = {
    solido: 'Sólido', pulso: 'Pulso', estrobo: 'Estrobo suave', ola: 'Ola',
    onda: 'Onda desde escenario', arcoiris: 'Arcoíris', texto: 'Texto (mosaico)', bandera: 'Bandera de Chile', tela: 'Tela al viento',
  };

  // ---------- Bandera de Chile ----------
  // u: 0 = izquierda → 1 = derecha de quien mira; v: 0 = arriba → 1 = abajo.
  // Cantón azul de 1/3 del largo y media altura, con estrella blanca al centro; franja blanca arriba, roja abajo.
  const AZUL_CL = [0, 57, 166], ROJO_CL = [213, 43, 30], BLANCO = [255, 255, 255];
  const ESTRELLA = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + k * Math.PI / 5;
    const r = k % 2 === 0 ? 0.34 : 0.34 * 0.382;
    return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
  });
  function dentroDe(poligono, x, y) {
    let dentro = false;
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
      const [xi, yi] = poligono[i], [xj, yj] = poligono[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  // conEstrella: en zonas generales (solo 3×3 subzonas) la estrella no se distingue y taparía el cantón
  function colorBandera(u, v, conEstrella) {
    if (v >= 0.5) return ROJO_CL;
    if (u >= 1 / 3) return BLANCO;
    return conEstrella && dentroDe(ESTRELLA, u * 3, v * 2) ? BLANCO : AZUL_CL;
  }

  const rgbCache = new Map();
  function hexRgb(hex) {
    if (!rgbCache.has(hex)) {
      const n = parseInt(String(hex).slice(1), 16) || 0;
      rgbCache.set(hex, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    return rgbCache.get(hex);
  }
  const mezcla = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

  function hsv(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
    return [r * 255, g * 255, b * 255];
  }

  // Banda que avanza: intensidad 0..1 según la distancia d recorrida por el frente.
  function banda(d, el, velocidad, ancho, separacion) {
    const u = (((d - velocidad * el) % separacion) + separacion) % separacion;
    return u < ancho ? Math.sin(Math.PI * u / ancho) : 0;
  }

  // Devuelve [r,g,b] para una capa, una posición y un instante (ms del servidor).
  function colorEn(capa, pos, t) {
    if (!capa || !pos) return [0, 0, 0];
    const c1 = hexRgb(capa.color || '#ffffff');
    const c2 = hexRgb(capa.color2 || '#000000');
    const el = Math.max(0, t - (capa.inicio || 0)) / 1000; // segundos desde que empezó
    const v = capa.velocidad ?? 20;

    switch (capa.efecto) {
      case 'solido':
        return c1;
      case 'pulso': {
        const hz = Math.min(MAX_HZ_ESTROBO, (capa.bpm || 60) / 60); // mismo tope que el estrobo
        const k = 0.5 + 0.5 * Math.cos(2 * Math.PI * el * hz);
        return mezcla(c2, c1, k);
      }
      case 'estrobo': {
        const hz = Math.min(MAX_HZ_ESTROBO, Math.max(0.5, capa.hz || 2));
        return Math.floor(el * hz * 2) % 2 === 0 ? c1 : c2;
      }
      case 'ola': {
        const a = (capa.angulo ?? 0) * Math.PI / 180;
        const d = pos.x * Math.cos(a) + pos.y * Math.sin(a);
        return mezcla(c2, c1, banda(d, el, v, 12, 60));
      }
      case 'onda': {
        const d = Math.hypot(pos.x, pos.y);
        return mezcla(c2, c1, banda(d, el, v, 10, 45));
      }
      case 'arcoiris': {
        const a = (capa.angulo ?? 0) * Math.PI / 180;
        const d = pos.x * Math.cos(a) + pos.y * Math.sin(a);
        const h = ((d / 80 - el * v / 100) % 1 + 1) % 1;
        return hsv(h, 1, 1);
      }
      case 'texto':
        return pixelTexto(capa, pos.grid, el, v) ? c1 : c2;
      case 'bandera': {
        const c = coordsTela(capa, pos);
        if (!c) return BLANCO;
        const f = flameo(c.u, c.w, el, v);
        if (!f) return [0, 0, 0]; // fuera de la tela (bordes que flamean): apagado
        const k = 0.6 + 0.4 * f.luz; // luz en las crestas, sombra en los valles
        const [r, g, b] = colorBandera(f.u, f.w, c.estrella);
        return [r * k, g * k, b * k];
      }
      case 'tela': {
        // Tela de un solo color: el flameo se ve solo con tonos del mismo color (oscuro en los valles,
        // pleno en las crestas, con un leve brillo hacia el blanco como el satín)
        const c = coordsTela(capa, pos);
        if (!c) return c1;
        const f = flameo(c.u, c.w, el, v);
        if (!f) return c2;
        const k = 0.35 + 0.65 * f.luz;
        const brillo = v > 0 ? 0.3 * Math.pow(f.luz, 6) : 0; // sin viento no hay pliegues ni brillo
        return mezcla([c1[0] * k, c1[1] * k, c1[2] * k], BLANCO, brillo);
      }
      default:
        return [0, 0, 0];
    }
  }

  // Coordenadas (u: 0 = asta/izquierda → 1 = punta; w: 0 = arriba → 1 = abajo) de una posición dentro de una
  // tela o bandera. modo 'completa': una sola tela con todo el público, vista desde el escenario;
  // modo 'sector': una por sector numerado (vista desde la cancha) y una para las zonas generales.
  function coordsTela(capa, pos) {
    if (capa.modo !== 'sector' && pos.vista) {
      return { u: pos.vista.u, w: pos.vista.v, estrella: false }; // a esta escala la estrella queda deforme
    }
    if (pos.grid) {
      return { u: (pos.grid.col + 0.5) / pos.grid.cols, w: (pos.grid.rows - 1 - pos.grid.row + 0.5) / pos.grid.rows, estrella: true };
    }
    if (pos.rel) return { u: 1 - pos.rel.u, w: 1 - pos.rel.v, estrella: false }; // vista desde el escenario: el fondo va arriba
    return null;
  }

  // Flameo como tela al viento (velocidad = fuerza del viento; 0 = quieta). Las ondas nacen en el asta
  // (u = 0) y viajan hacia la punta; el asta no se mueve y la amplitud crece hacia la punta.
  // Devuelve la posición desplazada y la luz (0 = valle, 1 = cresta), o null si ese punto quedó fuera de la tela.
  function flameo(u, w, el, velocidad) {
    if (!(velocidad > 0)) return { u, w, luz: 1 };
    const viento = velocidad / 20; // 20 = brisa normal
    const fase = 2 * Math.PI * (u * 1.6 - el * 0.6 * viento) + w * 1.8; // pliegues algo diagonales
    const amp = 0.07 * Math.min(1.5, viento) * u;
    const w2 = w + amp * Math.sin(fase);
    const u2 = u - 0.03 * u * (1 - Math.cos(fase)); // la punta se recoge en cada pliegue
    if (w2 < 0 || w2 > 1 || u2 > 1) return null;
    return { u: u2, w: w2, luz: 0.5 + 0.5 * Math.cos(fase - 0.9) };
  }

  // ¿El asiento queda dentro de una letra? Solo aplica a sectores numerados (con grilla).
  function pixelTexto(capa, grid, el, velocidad) {
    if (!grid) return false;
    const cols = columnasTexto(capa.texto || '');
    if (!cols.length) return false;
    // Letras de 7 filas; se agrandan solo si el sector es alto y ancho (cabe ≥ 5 letras de ancho)
    const escala = Math.max(1, Math.floor(Math.min(grid.rows / 8, grid.cols / 30)));
    const altoTexto = 7 * escala;
    const filaDesdeArriba = grid.rows - 1 - grid.row; // la fila A queda abajo
    const ty = Math.floor((filaDesdeArriba - Math.floor((grid.rows - altoTexto) / 2)) / escala);
    if (ty < 0 || ty > 6) return false;

    const ancho = cols.length * escala;
    let px;
    if (velocidad > 0) {
      const total = ancho + grid.cols;
      const desplazamiento = Math.floor(el * velocidad);
      px = ((grid.col + desplazamiento) % total) - grid.cols; // entra por la derecha
    } else {
      px = grid.col - Math.floor((grid.cols - ancho) / 2); // centrado y fijo
    }
    const gc = Math.floor(px / escala);
    if (px < 0 || gc >= cols.length) return false;
    return (cols[gc] & (1 << (6 - ty))) !== 0;
  }

  // ---------- Estado de zonas con cambios programados ----------
  // Cada capa trae "inicio" (hora del servidor). Hasta ese instante sigue la capa anterior,
  // así todos los teléfonos cambian juntos aunque el mensaje llegue con distinto retraso.
  function crearReproductor() {
    const zonas = {};
    return {
      actualizar(estado) {
        for (const [zona, capa] of Object.entries(estado.capas)) {
          const z = zonas[zona];
          if (!z) zonas[zona] = { prev: capa, cur: capa };
          else if (z.cur.id !== capa.id) {
            if (ahora() >= z.cur.inicio) z.prev = z.cur;
            z.cur = capa;
          }
        }
      },
      capa(zona, t) {
        const z = zonas[zona];
        if (!z) return null;
        return t >= (z.cur.inicio || 0) ? z.cur : z.prev;
      },
    };
  }

  // ubicacion (solo público): se informa al servidor para mostrar la ocupación real en el panel
  function conectar({ rol, zona, ubicacion, alEstado, alStats, alOcupacion, alConexion }) {
    const q = new URLSearchParams({ rol });
    if (zona) q.set('zona', zona);
    if (ubicacion) {
      for (const k of ['fila', 'asiento', 'profundidad', 'lado']) if (ubicacion[k] !== undefined) q.set(k, ubicacion[k]);
    }
    const es = new EventSource('/api/events?' + q);
    es.addEventListener('estado', (e) => alEstado && alEstado(JSON.parse(e.data)));
    es.addEventListener('stats', (e) => alStats && alStats(JSON.parse(e.data)));
    es.addEventListener('ocupacion', (e) => alOcupacion && alOcupacion(decodificarOcupacion(JSON.parse(e.data))));
    es.onopen = () => alConexion && alConexion(true);
    es.onerror = () => alConexion && alConexion(false);
    return es;
  }

  // { totalAsientos, asientos: base64 bitset, generales } → { ocupado(idx), generales, totalAsientos }
  function decodificarOcupacion(o) {
    const bin = atob(o.asientos);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return {
      totalAsientos: o.totalAsientos,
      generales: o.generales,
      ocupado: (idx) => (bytes[idx >> 3] & (1 << (idx & 7))) !== 0,
    };
  }

  // Índice global de cada asiento (mismo orden que usa el servidor): clave "sector|fila|asiento" → índice
  function indiceAsientos(recinto) {
    const indice = new Map();
    let n = 0;
    for (const s of recinto.sectores) {
      if (s.tipo === 'numerada') for (const [fila, asiento] of s.asientos) indice.set(`${s.id}|${fila}|${asiento}`, n++);
    }
    return indice;
  }

  async function cargarRecinto() {
    const r = await fetch('/api/recinto');
    return prepararRecinto(await r.json());
  }

  const css = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;

  window.Show = {
    reloj, ahora, sincronizarReloj, cargarRecinto, prepararRecinto, posicionDe, relEnRect, vistaEn, colorEn, css, indiceAsientos,
    crearReproductor, conectar, EFECTOS, PROFUNDIDADES, LADOS, MAX_HZ_ESTROBO,
  };
})();
