// Presets del concierto de BABYMETAL en Santiago (jueves 3 dic 2026, Movistar Arena).
// Orden basado en el setlist de la gira mundial 2026 (fechas de octubre en setlist.fm); el setlist
// de Santiago puede variar. Los BPM son aproximados: ajústalos en el ensayo.
// zonas: 'todas' | 'numeradas' (galerías con asiento) | 'generales' (cancha) | ['ID', ...]
(function () {
  const ROJO = '#e60012', NEGRO = '#000000', BLANCO = '#ffffff';

  (window.CONCIERTOS ||= []).push({
    id: 'babymetal-2026',
    titulo: 'BABYMETAL',
    pestana: 'BABYMETAL · 3 dic 🦊',
    subtitulo: 'Jueves 3 dic 2026 · Movistar Arena',
    nota: 'Orden según el setlist de la gira 2026. Colores de la banda: rojo, negro y blanco. BPM aproximados.',
    presets: [
      {
        nombre: 'Bandera de Chile', destacado: true,
        descripcion: 'Una sola bandera gigante con todo el público (galerías + cancha), vista desde el escenario',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'bandera', modo: 'completa', velocidad: 20 } }],
      },
      {
        nombre: 'Bandera flameando 🌬️',
        descripcion: 'La bandera grande con viento fuerte: pliegues marcados y bordes que flamean',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'bandera', modo: 'completa', velocidad: 40 } }],
      },
      {
        nombre: 'Banderas por sector 🇨🇱',
        descripcion: 'Una bandera en cada galería (vista desde la cancha) y otra en la cancha',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'bandera', modo: 'sector', velocidad: 20 } }],
      },
      {
        cancion: 'BABYMETAL DEATH', nombre: 'Apertura DEATH',
        descripcion: 'Destellos rojos sobre negro',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'estrobo', color: ROJO, color2: NEGRO, hz: 2 } }],
      },
      {
        cancion: 'from me to u', nombre: 'Latido rojo',
        descripcion: 'Pulso rojo y negro en todo el recinto',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'pulso', color: ROJO, color2: NEGRO, bpm: 100 } }],
      },
      {
        cancion: 'Megitsune', nombre: 'Zorro 🦊',
        descripcion: 'Galerías: zorros y "KITSUNE" en mosaico · Cancha: pulso rojo y blanco',
        asignaciones: [
          { zonas: 'numeradas', capa: { efecto: 'texto', color: BLANCO, color2: ROJO, velocidad: 10, texto: '🦊 KITSUNE 🦊' } },
          { zonas: 'generales', capa: { efecto: 'pulso', color: BLANCO, color2: ROJO, bpm: 90 } },
        ],
      },
      {
        cancion: 'KxAxWxAxIxI', nombre: 'Kawaii rosado',
        descripcion: 'Ola rosada sobre blanco',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'ola', color: '#ff4fa3', color2: '#ffe3f1', velocidad: 18, angulo: 0 } }],
      },
      {
        cancion: 'Monochrome', nombre: 'Monocromo',
        descripcion: 'Onda blanca lenta desde el escenario, como linternas',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'onda', color: BLANCO, color2: '#101010', velocidad: 8 } }],
      },
      {
        cancion: 'METALI!!', nombre: 'Ola roja',
        descripcion: 'Ola roja rápida de lado a lado',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'ola', color: ROJO, color2: NEGRO, velocidad: 35, angulo: 0 } }],
      },
      {
        cancion: 'Iine!', nombre: 'Arcoíris',
        descripcion: 'Arcoíris girando por el recinto',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'arcoiris', velocidad: 30, angulo: 0 } }],
      },
      {
        cancion: 'RATATATA', nombre: 'Fiesta',
        descripcion: 'Arcoíris rápido de fondo a escenario',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'arcoiris', velocidad: 60, angulo: 270 } }],
      },
      {
        cancion: 'Gimme Chocolate!!', nombre: 'Saltos rojo/blanco',
        descripcion: 'Pulso rápido rojo y blanco',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'pulso', color: ROJO, color2: BLANCO, bpm: 170 } }],
      },
      {
        cancion: 'Headbangeeeeerrrrr!!!!!', nombre: 'Headbang',
        descripcion: 'Pulso rojo y negro al tempo',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'pulso', color: ROJO, color2: NEGRO, bpm: 160 } }],
      },
      {
        cancion: 'Road of Resistance', nombre: 'Himno final',
        descripcion: 'Galerías: "CHILE 🦊 BABYMETAL" · Cancha: onda roja',
        asignaciones: [
          { zonas: 'numeradas', capa: { efecto: 'texto', color: BLANCO, color2: ROJO, velocidad: 10, texto: 'CHILE 🦊 BABYMETAL' } },
          { zonas: 'generales', capa: { efecto: 'onda', color: ROJO, color2: NEGRO, velocidad: 20 } },
        ],
      },
      {
        nombre: 'Zorros fijos 🦊',
        descripcion: 'Zorros quietos en cada galería (fox sign), cancha en rojo',
        asignaciones: [
          { zonas: 'numeradas', capa: { efecto: 'texto', color: BLANCO, color2: ROJO, velocidad: 0, texto: '🦊🦊' } },
          { zonas: 'generales', capa: { efecto: 'solido', color: ROJO } },
        ],
      },
      {
        nombre: 'Apagón',
        descripcion: 'Todo en negro (entre canciones)',
        asignaciones: [{ zonas: 'todas', capa: { efecto: 'solido', color: NEGRO } }],
      },
    ],
  });
})();
