// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Sesión del administrador (panel del operador y simulador) para el evento de la página actual.
// La clave solo se envía a /api/login; después se usa el token de sesión que entrega el servidor.
// Sirve la clave general (todos los eventos) o la clave propia del evento (solo ese).
(function () {
  'use strict';
  const tramo = location.pathname.split('/').filter(Boolean)[0] || '';
  const EVENTO = /^[a-z0-9][a-z0-9-]{1,60}$/.test(tramo) ? tramo : '';
  const CLAVE = 'pc-sesion:' + EVENTO;

  const Sesion = {
    evento: EVENTO,
    get() { try { return localStorage.getItem(CLAVE) || ''; } catch (e) { return ''; } },
    set(token) { try { localStorage.setItem(CLAVE, token); } catch (e) {} },
    borrar() { try { localStorage.removeItem(CLAVE); } catch (e) {} },

    // true si la sesión guardada sirve para este evento (o si no se necesita clave), false si no sirve,
    // null si no se pudo consultar (sin red): en ese caso no hay que pedir la clave
    async verificar() {
      try {
        const r = await fetch('/api/sesion?evento=' + encodeURIComponent(EVENTO), { headers: { 'x-sesion': Sesion.get() }, cache: 'no-store' });
        const d = await r.json();
        return !!(d.valida || !d.requiereClave);
      } catch (e) { return null; }
    },

    async ingresar(clave) {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave, evento: EVENTO }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo ingresar');
      Sesion.set(d.sesion);
      return d;
    },

    async salir() {
      try { await fetch('/api/logout', { method: 'POST', headers: { 'x-sesion': Sesion.get() } }); } catch (e) {}
      Sesion.borrar();
    },
  };

  window.Sesion = Sesion;
})();
