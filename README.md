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

## Presets por concierto

Cada concierto tiene su pestaña en "Escenas rápidas" del panel, definida en `public/conciertos/<concierto>.js`. Para agregar otro concierto, copia el archivo y súmalo con un `<script>` en `operador.html`.

**BABYMETAL · 3 dic 2026, Movistar Arena** (`public/conciertos/babymetal.js`): presets en el orden del setlist de la gira 2026, con los colores de la banda (rojo, negro y blanco):
- **Bandera de Chile** (destacada): **una sola bandera gigante con todo el público**, vista desde el escenario. Cada persona se proyecta según cómo la ve la banda (ángulo horizontal y altura estimada por nivel y fila) y la bandera se reparte por cantidad de gente: la mitad que se ve más arriba forma la franja blanca y el cantón, y la de abajo la roja. El simulador tiene una "Vista desde el escenario" para revisarla.
- **Banderas por sector**: una bandera en cada galería (vista desde la cancha) y otra en la cancha.
- **Tela roja BABYMETAL**: efecto "Tela al viento", una gran tela de un solo color que flamea solo con tonos del mismo color (oscuro en los valles, pleno en las crestas y un leve brillo como satín). En la pestaña General está "Tela al viento (color elegido)", que usa el color seleccionado en el panel.
- **Bandera flameando**: la bandera grande como tela al viento. Las ondas nacen en el asta (lado del cantón) y viajan a la punta, hay pliegues con luz y sombra, y los bordes flamean. En el efecto "Bandera", la velocidad es la fuerza del viento (0 = quieta, 20 = brisa, 40 = viento fuerte).
- BABYMETAL DEATH → destellos rojos · Megitsune → zorros 🦊 y "KITSUNE" en mosaico · Monochrome → onda blanca lenta · METALI!! → ola roja · RATATATA → arcoíris rápido · Gimme Chocolate!! / Headbangeeeeerrrrr!!!!! → pulsos al tempo · Road of Resistance → "CHILE 🦊 BABYMETAL" en las galerías, entre otros.

El orden y los BPM son una referencia: hay que ajustarlos en el ensayo y con el setlist real de Santiago. Por seguridad, ni el estrobo ni el pulso superan 3 ciclos por segundo, pida lo que pida el preset.

## Recintos

Cada recinto vive en `data/recintos/<nombre>/`. El servidor usa `RECINTO` (por defecto `movistar-arena`):

| Recinto | Contenido |
|---|---|
| `movistar-arena` | Movistar/Santander Arena para Babymetal: cancha de pie en **4 sectores de luz** (C1–C4, cada uno con su cuadrícula 3×3: 36 celdas), 12 sectores de Platea Baja (B1–B12), 14 de Platea Alta (A1–A14) y Tribuna 1–2 (T1–T2), con **8.027 asientos**. |
| `demo` | Estadio de ejemplo (3 galerías, 3.240 asientos). Lo usan los tests. `set RECINTO=demo` para probarlo. |

Archivos:
- `recinto.json`: sectores (`numerada` o `general`), rectángulo de las zonas generales y escenario.
- `asientos.csv`: `sector,fila,asiento,x,y[,col]` en metros, con el escenario en `y = 0` y `x = 0` al centro. `col` (opcional) es la columna real del asiento en la grilla vista desde la cancha, con pasillos incluidos, para que los mosaicos respeten la geometría.

### Cómo se obtuvo el Movistar Arena
`tools/importar-puntoticket.js` convierte `puntoticket-crudo.json`, que contiene las grillas de asientos extraídas a mano y lento del selector de PuntoTicket de un evento con todas las ubicaciones abiertas. Cada sector del plano trae en su id el giro (`R`) con que PuntoTicket dibuja la grilla; deshaciendo ese giro se ubica cada asiento en el plano.

Limitaciones conocidas:
- **839 asientos (10,7 %) tienen número deducido**: eran filas completamente vendidas en el evento de referencia y el sitio no muestra sus números. Se toman de la fila vecina, porque la numeración avanza por columna en el 94 % de los casos. Hay que verificarlos con entradas reales.
- **Tribuna** se sacó de otro evento (DGM179), donde sí está habilitada: 2 filas de 40 asientos por sector. Tribuna 1 numera 1–40 y Tribuna 2 41–80, deducido de los pocos asientos libres. La fila A de Tribuna 1 no tenía ningún número visible y se asumió igual que la B.
- Los nombres B1–B12 / A1–A14 son propios (en sentido horario desde el escenario); Tribuna 1 y 2 son los nombres oficiales. En la web del público cada persona **toca su sector en el mapa**, así no necesita saber el nombre oficial.

`npm run recinto-demo` regenera el estadio de ejemplo.

## Límites del prototipo (pendiente para producción)

- **Escala:** un proceso Node con SSE aguanta unos pocos miles de conexiones. Para un estadio hay que pasar a un broadcast distribuido (Cloudflare Durable Objects, Ably, Pusher o un clúster con Redis pub/sub) con CDN.
- **Show precargado:** hoy los efectos se lanzan en vivo. Lo siguiente es una línea de tiempo por canción descargada antes del show, que solo necesite la señal de "arranca".
- **Brillo y linterna:** la web no puede subir el brillo ni usar la linterna en iPhone. Eso requiere app nativa.
- **Recintos curvos:** la grilla del mosaico usa el orden de los asientos dentro de cada fila. En galerías muy curvas conviene proyectar por coordenadas.
