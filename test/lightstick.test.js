// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cargarLightstick() {
  const ctx = { window: {}, setTimeout, clearTimeout, Date, Math, Promise, Uint8Array, Error, Number, String, Object, localStorage: { getItem: () => null, setItem: () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'lightstick.js'), 'utf8'), ctx);
  return ctx.window.Lightstick;
}

// Lightstick simulado: registra cada escritura (característica y bytes) y cuántas hubo a la vez
function lightstickFalso({ nombre = 'BTS_V4 LS', servicios, demoraMs = 5 } = {}) {
  const escrituras = [];
  let enCurso = 0, maxEnCurso = 0, oyentes = [];
  const caracteristica = (uuid) => {
    const escribir = async (datos) => {
      enCurso++; maxEnCurso = Math.max(maxEnCurso, enCurso);
      await new Promise((ok) => setTimeout(ok, demoraMs));
      escrituras.push({ uuid, bytes: [...datos], t: Date.now() });
      enCurso--;
    };
    return { uuid, properties: { write: true, writeWithoutResponse: true }, writeValueWithoutResponse: escribir, writeValueWithResponse: escribir, writeValue: escribir };
  };
  const gatt = {
    connected: false,
    connect: async () => { gatt.connected = true; return gatt; },
    disconnect: () => { gatt.connected = false; },
    getPrimaryService: async (uuid) => {
      if (!servicios[uuid]) throw new Error('NotFound');
      return { uuid, getCharacteristic: async (c) => { if (!servicios[uuid].includes(c)) throw new Error('NotFound'); return caracteristica(c); },
        getCharacteristics: async () => servicios[uuid].map(caracteristica) };
    },
    getPrimaryServices: async () => Object.keys(servicios).map((uuid) => ({ uuid, getCharacteristics: async () => servicios[uuid].map(caracteristica) })),
  };
  const dispositivo = { name: nombre, gatt, addEventListener: (ev, f) => { if (ev === 'gattserverdisconnected') oyentes.push(f); } };
  return { dispositivo, escrituras, maxEnCurso: () => maxEnCurso, cortar: () => { gatt.connected = false; oyentes.forEach((f) => f()); } };
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const BTS = { '0001fe01-0000-1000-8000-00805f9800c4': ['0001ff02-0000-1000-8000-00805f9800c4'], '0001fe06-0000-1000-8000-00805f9800c4': ['0001ff13-0000-1000-8000-00805f9800c4'] };

async function conectado(L, falso) {
  L.bluetooth = { requestDevice: async (opciones) => { falso.opciones = opciones; return falso.dispositivo; } };
  return L.conectar({});
}

test('lightstick: bytes de cada modelo y suma de control de P1Harmony', () => {
  const L = cargarLightstick();
  const m = Object.fromEntries(L.MODELOS.map((x) => [x.id, x]));
  assert.deepStrictEqual([...m['bts-v4'].formatos[0].bytes(255, 10, 0)], [1, 255, 10, 0]);
  assert.deepStrictEqual([...m['bts-v4'].formatos[0].apagar()], [0, 0, 0, 0]);
  assert.deepStrictEqual([...m.ateez.formatos[0].bytes(1, 2, 3)], [1, 0, 0, 1, 2, 3, 0, 0]);
  // Ver. 2: 01 FF 00 R G B 00 00 SUM, suma desde el 3.er byte (por defecto) o desde el 2.º
  assert.deepStrictEqual([...m.p1harmony.formatos[0].bytes(0x10, 0x20, 0x30)], [1, 0xff, 0, 0x10, 0x20, 0x30, 0, 0, 0x60]);
  assert.deepStrictEqual([...m.p1harmony.formatos[1].bytes(0x10, 0x20, 0x30)], [1, 0xff, 0, 0x10, 0x20, 0x30, 0, 0, 0x5f]);
  assert.strictEqual(m.p1harmony.formatos[2].bytes(255, 255, 255).length, 11);
  assert.ok(m.p1harmony.conRespuesta);
});

test('lightstick: busca por nombre o servicio y declara todos los servicios de luz', () => {
  const L = cargarLightstick();
  const o = L.opcionesBusqueda(false);
  assert.ok(o.filters.some((f) => f.namePrefix === 'BTS'));
  assert.ok(o.filters.some((f) => f.services && f.services[0].startsWith('8ec91001')));
  assert.strictEqual(o.optionalServices.length, 3);
  assert.ok(L.opcionesBusqueda(true).acceptAllDevices);
});

test('lightstick: el último color gana, una escritura a la vez y nunca fuera de la característica de color', async () => {
  const L = cargarLightstick();
  const falso = lightstickFalso({ servicios: BTS });
  const c = await conectado(L, falso);
  assert.strictEqual(c.estado, 'conectado');
  assert.strictEqual(c.modelo.id, 'bts-v4');
  for (let i = 0; i < 50; i++) c.enviar([i, 0, 0]); // 50 colores de golpe
  c.enviar([200, 100, 50]);
  await esperar(400);
  assert.ok(falso.escrituras.length <= 3, `escribió ${falso.escrituras.length} veces`);
  assert.deepStrictEqual(falso.escrituras.at(-1).bytes, [1, 200, 100, 50]);
  assert.strictEqual(falso.maxEnCurso(), 1);
  // El mismo color no se reenvía
  const antes = falso.escrituras.length;
  c.enviar([200, 100, 50]);
  await esperar(150);
  assert.strictEqual(falso.escrituras.length, antes);
  // Entre escrituras pasan al menos ~70 ms
  c.enviar([1, 2, 3]); await esperar(20); c.enviar([4, 5, 6]);
  await esperar(250);
  const ts = falso.escrituras.map((e) => e.t);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= L.INTERVALO_MS - 15, `intervalo ${ts[i] - ts[i - 1]} ms`);
  assert.ok(falso.escrituras.every((e) => e.uuid === '0001ff02-0000-1000-8000-00805f9800c4'));
  c.apagar();
  await esperar(150);
  assert.deepStrictEqual(falso.escrituras.at(-1).bytes, [0, 0, 0, 0]);
});

test('lightstick: reconoce el modelo por servicio aunque el nombre no calce, y reconecta si se corta', async () => {
  const L = cargarLightstick();
  const falso = lightstickFalso({ nombre: 'LIGHTINY', servicios: { '8ec91001-f315-4f60-9fb8-838830daea50': ['8ec91002-f315-4f60-9fb8-838830daea50'] } });
  const estados = [];
  L.bluetooth = { requestDevice: async () => falso.dispositivo };
  const c = await L.conectar({ alCambio: (x) => estados.push(x.estado) });
  assert.strictEqual(c.modelo.id, 'ateez');
  falso.cortar();
  assert.strictEqual(c.estado, 'reconectando');
  await esperar(1200); // primer reintento al segundo
  assert.strictEqual(c.estado, 'conectado');
  c.enviar([9, 8, 7]);
  await esperar(150);
  assert.deepStrictEqual(falso.escrituras.at(-1).bytes, [1, 0, 0, 9, 8, 7, 0, 0]);
  c.desconectar();
  await esperar(300);
  assert.strictEqual(c.estado, 'desconectado');
});

test('lightstick: un dispositivo sin servicio de luz conocido queda como incompatible, con sus servicios para el diagnóstico', async () => {
  const L = cargarLightstick();
  const falso = lightstickFalso({ nombre: 'Audífonos', servicios: { '0000180f-0000-1000-8000-00805f9b34fb': ['00002a19-0000-1000-8000-00805f9b34fb'] } });
  L.bluetooth = { requestDevice: async () => falso.dispositivo };
  let ultima;
  await assert.rejects(L.conectar({ todos: true, alCambio: (x) => { ultima = x; } }));
  assert.strictEqual(ultima.estado, 'incompatible');
  assert.strictEqual(ultima.servicios.length, 1);
  assert.strictEqual(falso.escrituras.length, 0);
});
