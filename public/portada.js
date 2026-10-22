// Pixel Crowd — Copyright (c) 2026 Javier Julian Muñoz Navarrete
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 (ver LICENSE.md)
// Portada viva: una grilla de pequeños teléfonos que se encienden en una ola desde abajo y luego flamean
// como una tela, con el mismo motor que usa el show. Algunos quedan apagados, como en un público real.
// Respeta "reducir animaciones" y se pausa cuando no se ve. Requiere show.js.
(function () {
  'use strict';

  // opciones: { color, fondo, activo: () => boolean (si debe animarse ahora) }
  function hero(canvas, opciones = {}) {
    const ctx = canvas.getContext('2d');
    const fondo = opciones.fondo || '#15122A';
    const capa = { id: 'portada', efecto: 'tela', modo: 'sector', color: opciones.color || '#FF2E4D', color2: fondo, velocidad: 24, inicio: 0 };
    const activo = opciones.activo || (() => true);
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let celdas = [], ancho = 0, alto = 0, paso = 12, cols = 0, rows = 0;
    let inicio = null, visible = true;

    function medir() {
      const dpr = window.devicePixelRatio || 1;
      ancho = canvas.clientWidth;
      alto = Math.round(ancho * 0.56);
      paso = Math.max(11, ancho / 32);
      cols = Math.floor(ancho / paso);
      rows = Math.floor(alto / paso);
      canvas.style.height = alto + 'px';
      canvas.width = ancho * dpr;
      canvas.height = alto * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let semilla = 11;
      const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
      celdas = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        celdas.push({ x, y, apagado: azar() < 0.07, grid: { col: x, row: rows - 1 - y, cols, rows } });
      }
    }

    const BRUMA = [38, 32, 70], BRILLO = [255, 241, 224];
    function dibujar(ahora) {
      if (inicio === null) inicio = ahora;
      const intro = reducir ? 1 : Math.min(1, (ahora - inicio) / 1800); // la ola sube en 1,8 s
      const t = Date.now();
      const ox = (ancho - cols * paso) / 2, oy = (alto - rows * paso) / 2;
      const w = paso * 0.56, h = paso * 0.74; // proporción de una pantalla de teléfono
      ctx.fillStyle = fondo;
      ctx.fillRect(0, 0, ancho, alto);
      for (const c of celdas) {
        const desdeAbajo = (rows - 1 - c.y) / rows;
        const frente = intro * 1.25 - desdeAbajo; // > 0: la ola ya pasó por esta fila
        let color;
        if (c.apagado || frente <= 0) color = BRUMA;
        else {
          color = Show.colorEn(capa, { grid: c.grid }, t);
          if (frente < 0.12) { // borde de la ola: destello cálido
            const k = 1 - frente / 0.12;
            color = [color[0] + (BRILLO[0] - color[0]) * k, color[1] + (BRILLO[1] - color[1]) * k, color[2] + (BRILLO[2] - color[2]) * k];
          }
        }
        ctx.fillStyle = Show.css(color);
        const px = ox + c.x * paso + (paso - w) / 2, py = oy + c.y * paso + (paso - h) / 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(px, py, w, h, Math.min(2.5, w / 4)) : ctx.rect(px, py, w, h);
        ctx.fill();
      }
    }

    function bucle(ahora) {
      if (visible && !document.hidden && activo()) dibujar(ahora);
      if (!reducir) requestAnimationFrame(bucle);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(canvas);
    }
    window.addEventListener('resize', () => { medir(); if (reducir) dibujar(performance.now()); });
    medir();
    requestAnimationFrame(bucle);
  }

  window.Portada = { hero };
})();
