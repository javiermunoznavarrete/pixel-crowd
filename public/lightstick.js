// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Modo lightstick (beta): un teléfono controla un lightstick por Bluetooth (Web Bluetooth, solo Chrome/Edge en
// Android y escritorio). El lightstick toma el mismo color que el motor ya calcula para la pantalla, así que la
// persona puede apagar la pantalla y ahorrar batería. Implementación propia; de la documentación de la comunidad
// solo se usan los identificadores y el formato de los bytes. Nunca se escribe fuera del servicio de luz de cada
// modelo (en particular, nunca en el de actualización de firmware).
(function () {
  'use strict';

  const INTERVALO_MS = 70; // mínimo entre escrituras: el lightstick no acepta más de ~14 cambios por segundo
  const REINTENTOS = [1, 2, 4, 8, 15]; // segundos de espera para reconectar si se corta

  // Suma de control de P1Harmony: 8 bits bajos de la suma desde `desde` hasta el byte anterior a la suma
  const conSuma = (bytes, desde) => bytes.concat(bytes.slice(desde).reduce((a, b) => a + b, 0) & 0xff);

  // Cada modelo puede tener varios formatos posibles mientras no se confirmen con el lightstick en la mano: el
  // diagnóstico permite probarlos uno a uno. El primero es el que se usa por defecto.
  const MODELOS = [
    {
      id: 'bts-v4', nombre: 'compatible con ARMY Bomb Ver. 4', prefijos: ['BTS', 'BBOMB'],
      servicio: '0001fe01-0000-1000-8000-00805f9800c4', caracteristica: '0001ff02-0000-1000-8000-00805f9800c4',
      formatos: [{ nombre: '[1, R, G, B]', bytes: (r, g, b) => [1, r, g, b], apagar: () => [0, 0, 0, 0] }],
    },
    {
      id: 'ateez', nombre: 'compatible con el lightstick de ATEEZ', prefijos: [],
      servicio: '8ec91001-f315-4f60-9fb8-838830daea50', caracteristica: '8ec91002-f315-4f60-9fb8-838830daea50',
      formatos: [{ nombre: '01 00 00 R G B 00 00', bytes: (r, g, b) => [1, 0, 0, r, g, b, 0, 0], apagar: () => [1, 0, 0, 0, 0, 0, 0, 0] }],
    },
    {
      id: 'p1harmony', nombre: 'compatible con el lightstick de P1Harmony', prefijos: ['P1H'], conRespuesta: true,
      servicio: '00010203-0405-0607-0809-0a0b0c0d1911', caracteristica: '00010203-0405-0607-0809-0a0b0c0d2b19',
      formatos: [
        { nombre: 'Ver. 2, suma desde el 3.er byte', bytes: (r, g, b) => conSuma([1, 0xff, 0, r, g, b, 0, 0], 2) },
        { nombre: 'Ver. 2, suma desde el 2.º byte', bytes: (r, g, b) => conSuma([1, 0xff, 0, r, g, b, 0, 0], 1) },
        { nombre: 'Ver. 1, suma desde el 3.er byte', bytes: (r, g, b) => conSuma([1, 1, 0x0b, 0, 0, r, g, b, 0, 0], 2) },
        { nombre: 'Ver. 1, suma desde el 2.º byte', bytes: (r, g, b) => conSuma([1, 1, 0x0b, 0, 0, r, g, b, 0, 0], 1) },
      ],
    },
  ];
  const SERVICIOS = MODELOS.map((m) => m.servicio);

  const byte = (v) => Math.max(0, Math.min(255, Math.round(v || 0)));
  const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const bluetooth = () => api.bluetooth || (typeof navigator !== 'undefined' ? navigator.bluetooth : undefined);
  const disponible = () => !!bluetooth();

  // Filtros de búsqueda: por nombre anunciado o por servicio anunciado (ATEEZ no tiene un nombre fijo)
  function opcionesBusqueda(todos) {
    if (todos) return { acceptAllDevices: true, optionalServices: SERVICIOS };
    const filtros = [];
    for (const m of MODELOS) {
      for (const p of m.prefijos) filtros.push({ namePrefix: p });
      if (!m.prefijos.length) filtros.push({ services: [m.servicio] });
    }
    return { filters: filtros, optionalServices: SERVICIOS };
  }

  // Pide el lightstick (debe llamarse dentro de un toque) y lo conecta. `alCambio(conexion)` avisa cada cambio de estado.
  async function conectar({ todos = false, alCambio = () => {} } = {}) {
    const dispositivo = await bluetooth().requestDevice(opcionesBusqueda(todos));
    const c = crearConexion(dispositivo, alCambio);
    await c.abrir();
    return c;
  }

  function crearConexion(dispositivo, alCambio) {
    const c = {
      dispositivo, nombre: dispositivo.name || 'Sin nombre', modelo: null, formato: 0, estado: 'conectando',
      escrituras: 0, errores: 0, ultimoError: '', ultimosBytes: '', latenciaMs: 0, servicios: [],
      abrir, enviar, apagar, desconectar, usarFormato, probar, informe,
    };
    let caracteristica = null, pendiente = null, ultimo = '', ocupado = false, ultimaVez = 0, cerrada = false;

    function cambiar(estado) { c.estado = estado; alCambio(c); }

    async function abrir() {
      cambiar('conectando');
      const gatt = await dispositivo.gatt.connect();
      if (!c.modelo) {
        // El modelo se reconoce por el nombre y, si no, por cuál de los servicios de luz conocidos tiene
        const porNombre = MODELOS.filter((m) => m.prefijos.some((p) => c.nombre.startsWith(p)));
        for (const m of porNombre.concat(MODELOS.filter((x) => !porNombre.includes(x)))) {
          try { await gatt.getPrimaryService(m.servicio); c.modelo = m; break; } catch (e) {}
        }
        if (!c.modelo) { await revisarServicios(gatt); cambiar('incompatible'); throw new Error('Este dispositivo no tiene un servicio de luz conocido'); }
        try { c.formato = Math.min(Number(localStorage.getItem('lightstick-formato:' + c.modelo.id)) || 0, c.modelo.formatos.length - 1); } catch (e) {}
      }
      const servicio = await gatt.getPrimaryService(c.modelo.servicio);
      try {
        caracteristica = await servicio.getCharacteristic(c.modelo.caracteristica);
      } catch (e) {
        await revisarServicios(gatt);
        cambiar('incompatible');
        throw new Error('No se encontró la característica de color');
      }
      if (!dispositivo.pcEscuchando) {
        dispositivo.pcEscuchando = true;
        dispositivo.addEventListener('gattserverdisconnected', () => { if (!cerrada) reconectar(); });
      }
      ultimo = '';
      cambiar('conectado');
      bombear();
    }

    // Se cortó: se reintenta solo unas veces, con esperas cada vez más largas
    async function reconectar() {
      caracteristica = null;
      for (const s of REINTENTOS) {
        cambiar('reconectando');
        await esperar(s * 1000);
        if (cerrada) return;
        try { await abrir(); return; } catch (e) { c.ultimoError = String(e.message || e); }
      }
      cambiar('desconectado');
    }

    // Lista los servicios y características permitidos, para el diagnóstico
    async function revisarServicios(gatt) {
      try {
        const servicios = await gatt.getPrimaryServices();
        c.servicios = await Promise.all(servicios.map(async (s) => {
          let cars = [];
          try { cars = await s.getCharacteristics(); } catch (e) {}
          return { uuid: s.uuid, caracteristicas: cars.map((x) => ({ uuid: x.uuid,
            propiedades: ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((p) => x.properties && x.properties[p]) })) };
        }));
      } catch (e) { c.servicios = []; }
    }

    // El último color gana: si llega uno nuevo mientras se escribe el anterior, reemplaza al pendiente
    function enviar(rgb) {
      const r = byte(rgb[0]), g = byte(rgb[1]), b = byte(rgb[2]);
      const clave = r + ',' + g + ',' + b;
      if (clave === ultimo && !pendiente) return;
      pendiente = { r, g, b, clave };
      bombear();
    }

    async function bombear() {
      if (ocupado || !pendiente || !caracteristica || c.estado !== 'conectado') return;
      ocupado = true;
      try {
        const falta = INTERVALO_MS - (Date.now() - ultimaVez);
        if (falta > 0) await esperar(falta);
        const p = pendiente;
        pendiente = null;
        if (p && p.clave !== ultimo) {
          const f = c.modelo.formatos[c.formato];
          const bytes = p.apagar ? (f.apagar || (() => f.bytes(0, 0, 0)))() : f.bytes(p.r, p.g, p.b);
          await escribir(bytes);
          ultimo = p.clave;
        }
      } catch (e) {
        c.errores++;
        c.ultimoError = String(e.message || e);
      } finally {
        ultimaVez = Date.now();
        ocupado = false;
      }
      if (pendiente) bombear();
    }

    async function escribir(bytes) {
      const datos = new Uint8Array(bytes);
      const inicio = Date.now();
      const p = caracteristica.properties || {};
      if (!c.modelo.conRespuesta && p.writeWithoutResponse && caracteristica.writeValueWithoutResponse) await caracteristica.writeValueWithoutResponse(datos);
      else if (caracteristica.writeValueWithResponse) await caracteristica.writeValueWithResponse(datos);
      else await caracteristica.writeValue(datos);
      c.latenciaMs = Date.now() - inicio;
      c.escrituras++;
      c.ultimosBytes = hex(bytes);
    }

    function apagar() { pendiente = { apagar: true, clave: 'apagado' }; bombear(); }

    function desconectar() {
      cerrada = true;
      apagar();
      setTimeout(() => { try { dispositivo.gatt.disconnect(); } catch (e) {} cambiar('desconectado'); }, INTERVALO_MS * 3);
    }

    // Diagnóstico: cambia el formato de bytes (se recuerda por modelo) y fuerza un color de prueba
    function usarFormato(i) {
      c.formato = i;
      try { localStorage.setItem('lightstick-formato:' + c.modelo.id, String(i)); } catch (e) {}
      ultimo = '';
    }
    function probar(rgb) { ultimo = ''; enviar(rgb); }

    function informe() {
      return {
        nombre: c.nombre, modelo: c.modelo && c.modelo.id, formato: c.modelo && c.modelo.formatos[c.formato].nombre, estado: c.estado,
        escrituras: c.escrituras, errores: c.errores, ultimoError: c.ultimoError, ultimosBytes: c.ultimosBytes, latenciaMs: c.latenciaMs,
        servicios: c.servicios, navegador: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };
    }

    return c;
  }

  const api = { disponible, conectar, MODELOS, INTERVALO_MS, opcionesBusqueda, bluetooth: null };
  window.Lightstick = api;
})();
