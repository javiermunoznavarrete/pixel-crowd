// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Estadísticas de uso con Google Analytics 4, solo en las páginas del público.
// El servidor pone en ID la variable de entorno GA4_ID; sin ella no se carga nada de Google.
//
// Privacidad: modo de consentimiento de Google. Mientras la persona no acepta, GA4 no guarda cookies
// (solo recibe avisos sin identificador). Nunca se envían datos personales: solo el evento, el tipo de
// zona y el sector elegido.
(function () {
  'use strict';
  const ID = '__GA4_ID__';
  const CLAVE = 'pc-consentimiento'; // 'si' | 'no'
  const activo = /^G-[A-Z0-9]+$/.test(ID);

  // Uso desde las páginas: pcAnalitica('entrar_show', { sector: 'G1' }). Sin GA4 configurado no hace nada.
  window.pcAnalitica = function () {};
  if (!activo) return;

  const leer = () => { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } };
  const guardar = (v) => { try { localStorage.setItem(CLAVE, v); } catch (e) {} };
  const evento = location.pathname.split('/').filter(Boolean)[0] || 'inicio';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  const permiso = (v) => ({ analytics_storage: v, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'default', permiso(leer() === 'si' ? 'granted' : 'denied'));
  gtag('js', new Date());
  gtag('config', ID, { evento_pc: evento });

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);

  window.pcAnalitica = (nombre, datos = {}) => gtag('event', nombre, { evento_pc: evento, ...datos });

  // Aviso de estadísticas: una vez, abajo, sin tapar el flujo; la respuesta se recuerda en el teléfono
  if (leer()) return;
  const mostrar = () => {
    const aviso = document.createElement('div');
    aviso.setAttribute('role', 'region');
    aviso.setAttribute('aria-label', 'Estadísticas de uso');
    aviso.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:50;' +
      'max-width:520px;margin:0 auto;padding:14px 16px;border-radius:14px;background:rgba(21,18,42,.96);color:#FFF1E0;' +
      'font:14px/1.4 "Atkinson Hyperlegible",system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)';
    aviso.innerHTML = '<p style="margin:0 0 10px">¿Nos dejas medir de forma anónima cómo se usa Pixel Crowd? Nos ayuda a mejorarlo. No guardamos tu nombre ni tu teléfono.</p>' +
      '<div style="display:flex;gap:8px"><button data-v="si" style="flex:1;padding:10px;border-radius:10px;border:0;background:#FF2E4D;color:#fff;font-weight:700">Aceptar</button>' +
      '<button data-v="no" style="flex:1;padding:10px;border-radius:10px;border:1px solid #A39DCC;background:transparent;color:#FFF1E0">No, gracias</button></div>';
    aviso.addEventListener('click', (e) => {
      const v = e.target.dataset && e.target.dataset.v;
      if (!v) return;
      guardar(v);
      if (v === 'si') gtag('consent', 'update', permiso('granted'));
      aviso.remove();
    });
    document.body.appendChild(aviso);
  };
  if (document.body) mostrar(); else document.addEventListener('DOMContentLoaded', mostrar);
})();
