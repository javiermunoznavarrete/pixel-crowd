// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Paneles minimizables: cualquier elemento con data-plegable="<id>" se pliega/despliega tocando su
// primer <h2>. El estado se guarda por página en este dispositivo. Con data-plegado-movil, el panel
// arranca minimizado en pantallas angostas (si el usuario no lo cambió antes).
(function () {
  'use strict';

  const CLAVE = 'plegables:' + location.pathname;
  const MOVIL = window.matchMedia('(max-width: 900px)').matches;

  const css = document.createElement('style');
  css.textContent = `
    [data-plegable] > h2 { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; }
    [data-plegable] > h2::after { content: '▾'; margin-left: auto; font-size: 14px; transition: transform 0.2s; opacity: 0.7; }
    [data-plegable].plegado > h2::after { transform: rotate(-90deg); }
    [data-plegable].plegado > h2 { margin-bottom: 0 !important; }
    [data-plegable].plegado > :not(h2) { display: none !important; }
    [data-plegable] > h2:focus-visible { outline: 2px solid #ff3d7f; outline-offset: 2px; border-radius: 4px; }
  `;
  document.head.appendChild(css);

  let guardado = {};
  try { guardado = JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) {}
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(guardado)); } catch (e) {} };

  function aplicar(el, plegado) {
    el.classList.toggle('plegado', plegado);
    const h2 = el.querySelector(':scope > h2');
    if (h2) h2.setAttribute('aria-expanded', String(!plegado));
  }

  for (const el of document.querySelectorAll('[data-plegable]')) {
    const id = el.dataset.plegable;
    const h2 = el.querySelector(':scope > h2');
    if (!h2) continue;
    h2.setAttribute('role', 'button');
    h2.tabIndex = 0;
    const inicial = id in guardado ? guardado[id] : (MOVIL && el.hasAttribute('data-plegado-movil'));
    aplicar(el, inicial);
    const alternar = () => {
      const plegado = !el.classList.contains('plegado');
      aplicar(el, plegado);
      guardado[id] = plegado;
      guardar();
      // Los canvas que estaban ocultos tienen ancho 0: avisar para que se vuelvan a medir
      window.dispatchEvent(new Event('resize'));
    };
    h2.addEventListener('click', alternar);
    h2.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
  }
})();
