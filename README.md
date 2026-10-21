# Pantallas de concierto — prototipo mixto

Coordina las pantallas de los teléfonos del público, como los lightsticks, pero sin hardware.

- **Sectores numerados (galerías):** la persona elige fila y asiento. Con el mapa de numeración, cada asiento es un píxel con coordenadas exactas, lo que permite mosaicos de texto y olas precisas.
- **Sectores generales (cancha):** la persona toca en una cuadrícula de 3×3 dónde está (adelante/medio/atrás × izquierda/centro/derecha).

## Probar en red local (WiFi de la casa)

1. Conecta el PC y los teléfonos a **la misma WiFi**. Si tienes una VPN activa (NordVPN, etc.) y los teléfonos no conectan, desactívala o activa la opción de LAN.
2. Haz doble clic en **`iniciar.cmd`**. Se abren dos pestañas:
   - **`/conectar`**: un QR grande con la dirección de red, para mostrarlo en pantalla o proyectarlo.
   - **`/operador`**: el panel de control con la vista previa.
3. En cada teléfono, escanea el QR con la cámara, elige tu ubicación y toca **"Encender mi pantalla"**.
4. Desde el panel, prueba las **escenas rápidas** ("Colores por zona", "Ola lateral", "Texto en galerías"…). El panel muestra cuántos teléfonos hay conectados por zona.

Tips para la prueba:
- Reparte los teléfonos en distintas zonas (uno en Galería 1, otro en Cancha, etc.) para ver los colores por zona.
- Para ver una ola o un texto con pocos teléfonos, elige asientos vecinos de la misma galería (fila A, asientos 40, 41, 42…) y ponlos en fila sobre la mesa.
- Sube el brillo al máximo. La pantalla no se apaga sola: usa Wake Lock o, por HTTP, un video invisible (NoSleep.js).
- Si el puerto 3000 está ocupado: `set PORT=3001` y vuelve a ejecutar.
- Si Windows pregunta por el firewall al iniciar, acepta el acceso de Node.js.

## Uso manual

```bash
npm start            # o: node server.js   (Node 18+; sin dependencias)
```

| Página | URL |
|---|---|
| Público (teléfonos) | `http://<ip-del-pc>:3000/` |
| Panel del operador (con vista previa en vivo) | `http://localhost:3000/operador` |
| Simulador del estadio | `http://localhost:3000/simulador` |

Para probar con teléfonos reales, deben estar en la misma red WiFi que el PC. El servidor imprime la IP al arrancar.
Variables: `PORT` (por defecto 3000), `OP_TOKEN` (si se define, el panel debe enviar ese token), `URL_PUBLICO` (fuerza la URL del QR) y `ABRIR_NAVEGADOR` (abre las pestañas al arrancar).

Librerías incluidas en `public/vendor/` (se sirven desde el PC, funcionan sin internet): NoSleep.js 0.12.0 y qrcode-generator 1.4.4, ambas con licencia MIT.

```bash
npm test             # tests del motor de efectos y del servidor
```

## Cómo funciona

1. Cada teléfono sincroniza su reloj con el servidor (`/api/time`, estilo NTP) cada 30 s.
2. El operador aplica una **capa** (efecto + parámetros) a una o varias zonas. El servidor la programa unos 300 ms en el futuro y la difunde por Server-Sent Events.
3. Cada teléfono calcula **localmente** su color en cada cuadro con `colorEn(capa, posición, horaServidor)` (en `public/show.js`). No hay mensajes por cuadro, todos cambian a la vez y, si la red se cae, el efecto en curso sigue corriendo.

Efectos disponibles: sólido, pulso (BPM), estrobo suave (**máximo 3 Hz** por seguridad fotosensible), ola con dirección, onda desde el escenario, arcoíris y texto en mosaico (solo en sectores numerados).

## Usar el mapa de un recinto real

- `data/recinto.json`: sectores (`numerada` o `general`), rectángulo de la cancha y escenario. En sectores numerados, `invertirTexto` indica si el número de asiento crece hacia la izquierda de quien mira el mosaico, para que el texto se lea al derecho.
- `data/asientos.csv`: `sector,fila,asiento,x,y` en metros, con el escenario en `y = 0` y `x = 0` al centro. Reemplázalo por la numeración digitalizada del recinto.

`npm run recinto-demo` regenera el estadio de ejemplo: cancha y 3 galerías de 12 filas (3.240 asientos).

## Límites del prototipo (pendiente para producción)

- **Escala:** un proceso Node con SSE aguanta unos pocos miles de conexiones. Para un estadio hay que pasar a un broadcast distribuido (Cloudflare Durable Objects, Ably, Pusher o un clúster con Redis pub/sub) con CDN.
- **Show precargado:** hoy los efectos se lanzan en vivo. Lo siguiente es una línea de tiempo por canción descargada antes del show, que solo necesite la señal de "arranca".
- **Brillo y linterna:** la web no puede subir el brillo ni usar la linterna en iPhone. Eso requiere app nativa.
- **Recintos curvos:** la grilla del mosaico usa el orden de los asientos dentro de cada fila. En galerías muy curvas conviene proyectar por coordenadas.
