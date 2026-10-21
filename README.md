# Pantallas de concierto — prototipo mixto

Coordina las pantallas de los teléfonos del público, como los lightsticks, pero sin hardware.

- **Sectores numerados (galerías):** la persona elige fila y asiento. Con el mapa de numeración, cada asiento es un píxel con coordenadas exactas, lo que permite mosaicos de texto y olas precisas.
- **Sectores generales (cancha):** la persona toca en una cuadrícula de 3×3 dónde está (adelante/medio/atrás × izquierda/centro/derecha).

## Uso

```bash
npm start            # o: node server.js   (Node 18+; sin dependencias)
```

| Página | URL |
|---|---|
| Público (teléfonos) | `http://<ip-del-pc>:3000/` |
| Panel del operador (con vista previa en vivo) | `http://localhost:3000/operador` |
| Simulador del estadio | `http://localhost:3000/simulador` |

Para probar con teléfonos reales, deben estar en la misma red WiFi que el PC. El servidor imprime la IP al arrancar.
Variables: `PORT` (por defecto 3000) y `OP_TOKEN` (si se define, el panel debe enviar ese token).

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
