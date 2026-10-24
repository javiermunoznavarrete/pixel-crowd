# Pixel Crowd

**El público es la pantalla.** Pixel Crowd coordina las pantallas de los teléfonos del público para que funcionen como luces en un concierto: colores por sector, olas, mosaicos de texto y una bandera formada por todo el recinto.

**Solo el teléfono del usuario.** A diferencia de las pulseras LED (como PixMob o Xyloband), que necesitan repartir dispositivos y montar transmisores e infraestructura en el recinto, Pixel Crowd no usa hardware: se entra desde el navegador escaneando un QR, sin instalar apps.

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
| Lista de próximos shows | `http://localhost:3000/` |
| Público de un evento (teléfonos) | `http://<ip-del-pc>:3000/<evento>` (p. ej. `/babymetal-2026`) |
| Panel del operador (con vista previa en vivo) | `http://localhost:3000/<evento>/operador` |
| QR para proyectar | `http://localhost:3000/<evento>/conectar` |
| Simulador | `http://localhost:3000/<evento>/simulador` |

Las direcciones antiguas (`/operador`, `/conectar`, `/simulador`) llevan al próximo evento. Para probar con teléfonos reales, deben estar en la misma red WiFi que el PC; el servidor imprime las direcciones al arrancar.
Variables: `PORT` (por defecto 3000), `CLAVE_ADMIN` (clave general; tiene prioridad sobre `clave-admin.txt`), `CLAVE_EVENTO_<SLUG>` (clave de un evento), `URL_PUBLICO` (dirección base para los QR, en producción `https://pixelcrowd.cl/`), `ORIGEN_SECRETO` (ver **Seguridad**), `MAX_CONEXIONES`, `MAX_CONEXIONES_POR_IP` y `MAX_PEDIDOS_IP_10S` (topes contra abusos) y `ABRIR_NAVEGADOR` (abre las pestañas al arrancar).

### Entrada del administrador

Entra a **`/admin`** (o `/operador`), ingresa la clave general una vez y elige el evento: panel, simulador, QR o página del público. Se listan también los eventos ocultos, como `/demo`. La sesión de la clave general sirve en todos los eventos: dentro del panel, el menú de arriba cambia de evento sin volver a pedir la clave. Con la clave propia de un evento, se entra desde la dirección de ese evento (`/<evento>/operador`).

### Claves
El panel del operador y el simulador piden clave. Las páginas del público no.
- **Clave general:** entra a todos los eventos. Se lee de **`clave-admin.txt`** en la raíz del proyecto (archivo local que **no se sube a git**) o de la variable `CLAVE_ADMIN`.
- **Clave de un evento (opcional):** solo entra a ese evento, útil si otra persona opera ese show. Se lee de `data/eventos/<evento>/clave.txt` (tampoco se sube a git) o de `CLAVE_EVENTO_<SLUG>` (con guiones como `_`, p. ej. `CLAVE_EVENTO_BABYMETAL_2026`).
- Para cambiar una clave, edita el archivo y reinicia el servidor.
- Al ingresar, el servidor entrega una **sesión de 12 horas**. La clave no viaja en cada acción. Si el servidor se reinicia, el panel vuelve a pedir la clave.
- Tras **5 intentos fallidos** seguidos, esa IP queda bloqueada un minuto.
- Sin `clave-admin.txt` ni `CLAVE_ADMIN`, el panel queda abierto (solo para pruebas) y el servidor lo advierte al arrancar.
- En la red local se usa `http://`, sin cifrado: alguien conectado a la misma WiFi podría capturar la clave. En producción hay que usar HTTPS.

Librerías incluidas en `public/vendor/` (se sirven desde el PC, funcionan sin internet): NoSleep.js 0.12.0 y qrcode-generator 1.4.4, ambas con licencia MIT.

```bash
npm test             # tests del motor de efectos y del servidor
```

## SEO y buscadores con IA

- **Metadatos desde el servidor:** cada página pública sale con su título, descripción, canonical, Open Graph, tarjeta de X y datos estructurados JSON-LD (`WebSite`, `WebApplication` y, en cada show, `WebPage`). Se escriben en el marcador `<!--seo-->` de cada plantilla, así que los buscadores y las vistas previas de WhatsApp los ven sin ejecutar JavaScript. Los shows no se marcan como `Event`: Pixel Crowd es una acción de fans, no el concierto.
- **Portada:** la lista de shows y una sección de preguntas frecuentes vienen escritas en el HTML.
- **No se indexan** el panel, el simulador, el QR, `/admin`, la API ni los shows ocultos (`noindex` en el HTML y en `X-Robots-Tag`).
- **Archivos:** `/sitemap.xml` (se arma con los shows visibles), `/robots.txt` (permite búsqueda y respuestas de IA, no entrenamiento), `/llms.txt`, `/manifest.webmanifest` e íconos.
- **Imágenes para compartir** (1200×630) en `public/og/`: `pixel-crowd.png` y una por show. Para un show nuevo, captura `tools/imagen-og.html?show=…&lugar=…&fecha=…` a 1200×630 con Chrome o Edge sin ventana y guárdala como `public/og/<evento>.png`.

## Seguridad

En producción todo el tráfico entra por **Cloudflare**, que agrega a cada pedido una cabecera secreta (`x-pixel-origen`). Con `ORIGEN_SECRETO` definido, el servidor rechaza con 403 lo que no la trae, así que nadie se salta Cloudflare entrando por la dirección de Railway, y la IP real del visitante (`cf-connecting-ip`) es confiable.

- **Login:** bloqueo por IP real, cada vez más largo (1, 5, 15 y 60 minutos) tras 5 claves incorrectas, con demora en cada intento fallido, más un límite de Cloudflare de 10 intentos en 10 segundos. Un intruso no puede bloquear el ingreso de los demás.
- **Abusos:** topes de conexiones en vivo y de pedidos por IP y en total. Son generosos a propósito, porque en un recinto cientos de teléfonos salen por la misma IP de la compañía.
- **Navegador:** política de contenido que solo ejecuta los scripts de la app (los escritos en el HTML, por su huella), ninguna página se puede incrustar en otro sitio y `nosniff`.
- **Emergencia:** en `/admin`, **Cerrar las demás sesiones** expulsa a cualquier otro administrador. Todo lo que hay que hacer el día del show está en [`docs/plan-de-emergencia.md`](docs/plan-de-emergencia.md).

## Cómo funciona

1. Cada teléfono sincroniza su reloj con el servidor (`/api/time`, estilo NTP): al abrir (tras una espera al azar de hasta 2 s, para que miles de teléfonos no consulten en el mismo instante) y luego cada ~4 min. Se queda con la muestra de menor ida y vuelta y mide el tiempo con `performance.now()`, así un ajuste automático de la hora del teléfono no lo desfasa.
2. El operador aplica una **capa** (efecto + parámetros) a una o varias zonas, o una **secuencia** de capas con su segundo de inicio. El servidor las programa en el futuro y las difunde por Server-Sent Events.
3. Cada teléfono guarda la **cola** de cambios de su zona y calcula **localmente** su color en cada cuadro con `colorEn(capa, posición, horaServidor)` (en `public/show.js`). No hay mensajes por cuadro, todos cambian a la vez y, si la red se cae, el efecto en curso y el resto de la secuencia siguen corriendo.
4. Si la conexión abierta no funciona en la red del teléfono (no abre en 10 s o se corta 4 veces en 2 min), el teléfono pasa solo a **consultar** `/estado` cada ~3 s (con `ETag`, ±20 % al azar y esperas crecientes si falla). El panel los muestra como "con señal débil".
5. La web del público queda guardada en el teléfono (service worker): quien abre el link antes del concierto puede abrirla aunque la red del recinto esté saturada. Si el show se detiene, la persona puede elegir un **color manual** desde el panel que aparece al tocar la pantalla.

Efectos disponibles: sólido, pulso (BPM), estrobo suave (**máximo 3 Hz** por seguridad fotosensible), ola con dirección, onda desde el escenario, arcoíris y texto en mosaico (solo en sectores numerados).

## Eventos

Cada evento es una carpeta `data/eventos/<evento>/` con un `evento.json`. Cada uno tiene su propia dirección, su QR, su estado en vivo (las escenas de un show no afectan a otro, aunque sean la misma noche) y su pestaña de presets en el panel.

```json
{
  "titulo": "BABYMETAL", "lugar": "Movistar Arena",
  "fecha": "jueves 3 de diciembre", "fechaISO": "2026-12-03",
  "recinto": "movistar-arena",
  "presets": [ { "nombre": "…", "asignaciones": [ { "zonas": "todas", "capa": { "efecto": "bandera" } } ] } ]
}
```

- **Agregar un evento:** copia una carpeta, cambia el nombre (minúsculas, números y guiones: será la dirección), edita `evento.json` y despliega.
- **`fechaISO`** decide si el evento aparece como próximo, de hoy o terminado (hora de Chile). Un evento terminado muestra un cierre en vez del mapa.
- **`"oculto": true`** lo saca de la lista pública, pero su dirección sigue funcionando (sirve para ensayos).
- **`zonas`** en los presets: `todas`, `numeradas` (sectores con asiento), `generales` (cancha y zonas sin numerar) o una lista de IDs.
- **Secuencias:** un preset puede traer `pasos` en vez de `asignaciones`, cada uno con su segundo de inicio (`en`). Un toque programa la canción completa y, si la red se cae a la mitad, los teléfonos ya tienen el resto. Cualquier cambio nuevo en una zona reemplaza lo que venía para esa zona, y el botón **Cortar secuencia** borra lo programado dejando el efecto actual. Ejemplo en `data/eventos/demo/evento.json`:

```json
{ "cancion": "…", "nombre": "Canción completa", "pasos": [
  { "en": 0,  "asignaciones": [ { "zonas": "todas", "capa": { "efecto": "pulso", "color": "#2d7bff", "bpm": 80 } } ] },
  { "en": 40, "asignaciones": [ { "zonas": "todas", "capa": { "efecto": "bandera", "modo": "completa" } } ] }
] }
```

- **Reintentos:** cada envío del panel lleva un id. Si la red del operador falla, el panel reintenta hasta 4 veces con el mismo id y el servidor no lo aplica dos veces. Se puede tener un segundo operador de respaldo (misma clave) en otra parte del recinto.

Eventos actuales: `babymetal-2026` (BABYMETAL, Movistar Arena) y `atarashii-gakko-2026` (ATARASHII GAKKO!, Teatro Caupolicán), ambos el jueves 3 de diciembre de 2026, más `demo` (oculto, con el estadio de prueba).

**BABYMETAL · 3 dic 2026, Movistar Arena** (`data/eventos/babymetal-2026/evento.json`): presets en el orden del setlist de la gira 2026, con los colores de la banda (rojo, negro y blanco):
- **Bandera de Chile** (destacada): **una sola bandera gigante con todo el público**, vista desde el escenario. Cada persona se proyecta según cómo la ve la banda (ángulo horizontal y altura estimada por nivel y fila) y la bandera se reparte por cantidad de gente: la mitad que se ve más arriba forma la franja blanca y el cantón, y la de abajo la roja. El simulador tiene una "Vista desde el escenario" para revisarla.
- **Banderas por sector**: una bandera en cada galería (vista desde la cancha) y otra en la cancha.
- **Tela roja BABYMETAL**: efecto "Tela al viento", una gran tela de un solo color que flamea solo con tonos del mismo color (oscuro en los valles, pleno en las crestas y un leve brillo como satín). En la pestaña General está "Tela al viento (color elegido)", que usa el color seleccionado en el panel.
- **Bandera flameando**: la bandera grande como tela al viento. Las ondas nacen en el asta (lado del cantón) y viajan a la punta, hay pliegues con luz y sombra, y los bordes flamean. En el efecto "Bandera", la velocidad es la fuerza del viento (0 = quieta, 20 = brisa, 40 = viento fuerte).
- BABYMETAL DEATH → destellos rojos · Megitsune → zorros 🦊 y "KITSUNE" en mosaico · Monochrome → onda blanca lenta · METALI!! → ola roja · RATATATA → arcoíris rápido · Gimme Chocolate!! / Headbangeeeeerrrrr!!!!! → pulsos al tempo · Road of Resistance → "CHILE 🦊 BABYMETAL" en las galerías, entre otros.

El orden y los BPM son una referencia: hay que ajustarlos en el ensayo y con el setlist real de Santiago. Por seguridad, ni el estrobo ni el pulso superan 3 ciclos por segundo, pida lo que pida el preset.

## Recintos

Cada evento indica qué recinto usa (`"recinto"` en su `evento.json`) y varios eventos pueden compartir uno.

**Los mapas de recintos reales (Movistar Arena, Teatro Caupolicán…) no están en este repositorio:** viven en un repositorio privado, porque obtenerlos cuesta trabajo. Aquí solo está `data/recintos/demo`, un estadio de ejemplo (3 galerías, 3.240 asientos) que usan los tests y el evento de prueba `/demo`.

El servidor busca los recintos, en orden, en:
1. `RECINTOS_DIR` (una o varias carpetas, separadas por `;` en Windows o `:` en Linux; en Railway, `/data/recintos` del volumen),
2. `../pixel-crowd-recintos/recintos` (el repositorio privado clonado al lado de este),
3. `data/recintos` (el demo).

Si a un evento le falta su recinto, el servidor lo avisa y omite ese evento, así que una copia del código arranca igual con el demo.

Formato de un recinto (`<carpeta>/<nombre>/`):
- `recinto.json`: sectores (`numerada` o `general`), rectángulo de las zonas generales y escenario. Una zona general puede traer además su forma (`puntos`), sus 9 subzonas ya calculadas, su altura estimada y textos propios para la cuadrícula (p. ej. "Filas de abajo" en una gradería).
- `asientos.csv`: `sector,fila,asiento,x,y[,col]` en metros, con el escenario en `y = 0` y `x = 0` al centro. `col` (opcional) es la columna real del asiento en la grilla vista desde la cancha, con pasillos incluidos, para que los mosaicos respeten la geometría.

### Números de silla aportados por el público
Donde no hay mapa numerado (las graderías y palcos del Caupolicán, o cualquier zona general con sillas), la persona elige su zona y su celda y, **de forma opcional**, anota la fila y el número que ve en su silla. Así, después de uno o más shows, tenemos datos reales para reconstruir el mapa numerado aunque no consigamos el plano oficial.
- Se guardan **por recinto** en `aportes/<recinto>.jsonl` (o en la carpeta de `DATA_APORTES`): fecha, evento, zona, celda, fila, número y una huella anónima del teléfono (para no contar dos veces). Sin nombre, teléfono ni IP.
- Límite de 20 envíos por IP cada 10 minutos. El envío no bloquea el show: si no hay red, la pantalla se enciende igual.
- En el panel del operador, "Números de silla aportados" muestra el resumen por zona y celda (cuántos aportes, rango de números, filas vistas) y descarga todo en CSV.
- En Railway, la carpeta debe estar en un **volumen persistente**; si no, los aportes se pierden al redesplegar.

`npm run recinto-demo` regenera el estadio de ejemplo.

## Límites del prototipo (pendiente para producción)

- **Escala:** probado con 10.000 teléfonos simulados en un solo proceso Node (ver **Prueba de carga**). Falta repetir la prueba contra Railway, que agrega su proxy y la red real.
- **Secuencias por canción:** el motor ya las soporta; falta cargar los tiempos reales de cada canción (se toman del ensayo o de la grabación).
- **Brillo y linterna:** la web no puede subir el brillo ni usar la linterna en iPhone. Eso requiere app nativa.
- **Recintos curvos:** la grilla del mosaico usa el orden de los asientos dentro de cada fila. En galerías muy curvas conviene proyectar por coordenadas.

## Peso de la página con señal lenta

`tools/medir-carga.js` abre la página del público en Chrome sin ventana, con perfil nuevo y la red limitada a "Slow 3G" (400 kbit/s, 400 ms). Mide cuándo aparece el texto y el mapa, cuánto se descarga (incluido lo que baja el service worker) y, con el servidor apagado, si una segunda visita abre desde lo guardado:

```
node tools/medir-carga.js --evento babymetal-2026 --red lenta --repeticiones 3   # --servidor <carpeta> para medir otra versión
```

Resultado en BABYMETAL antes y después de aligerar la página (medianas de 3 corridas, servidor local):

| | Antes | Después |
|---|---|---|
| Mapa para elegir sector (red lenta) | 11,6 s | 3,0 s |
| Mapa con buena señal | 0,8 s | 0,3 s |
| Descarga total, con Analytics y fuentes | 593 KB | 343 KB |
| Del servidor propio | 355 KB | 104 KB |
| Queda guardado tras 1 visita | 3 scripts | página, mapa, evento y scripts |
| 2ª visita sin red | el mapa no aparece | el mapa aparece en 0,1 s |

Qué cambió: gzip y `ETag` en todo lo que es texto (el canal en vivo no se comprime); el mapa y el evento se piden desde el `<head>`; aviso y reintento si el mapa no carga; el service worker guarda página, mapa y evento en la primera visita y, sin copia guardada, espera a la red en vez de fallar; Analytics y las fuentes se cargan después del mapa (las fuentes no se cargan si el teléfono pide ahorrar datos).

## Estadísticas del show (internas)

El servidor registra cada **sesión de show**: empieza cuando un evento supera **50 teléfonos conectados** (los ensayos chicos no cuentan) y termina cuando pasa 10 minutos seguidos en 50 o menos. Si vuelve a subir antes (un intermedio, un reinicio del servidor), es la misma sesión. De cada una guarda el **máximo** con su hora y el desglose por zona, y **una muestra por minuto** (total, por zona y cuántos con señal débil). Son solo conteos, sin datos personales.

- **Dónde:** un archivo JSON por evento en `DATA_ESTADISTICAS` (en Railway, `/data/estadisticas` del volumen; en local, `estadisticas/`, fuera de git). Se escribe de forma atómica: nunca queda un archivo a medias.
- **Panel del operador:** sección **Estadísticas del show**, con la sesión en curso, la lista de sesiones con su máximo, la curva de la sesión elegida y la descarga en CSV (`/api/e/<evento>/estadisticas?formato=csv`, con la hora de Chile y una columna por zona).
- **Ajustes:** `UMBRAL_SESION` (50), `CIERRE_SESION_MS` (10 min) y `MUESTRA_MS` (1 min).
- **¿Por qué un archivo y no una base de datos?** Son pocos datos (un show de 4 h son ~240 muestras), escribe un solo servidor y así no se agrega otro servicio que pueda fallar la noche del show. Si algún día se corren varios servidores o se cruzan muchos shows, el paso natural es SQLite o Postgres; todo pasa por `estadisticasDe` y `guardarEstadisticas`.

Es el conteo exacto de teléfonos conectados. GA4 (abajo) solo cuenta a quienes aceptan el aviso.

## Estadísticas (Google Analytics 4)

Opcional. Define la variable `GA4_ID` (el ID de medición, `G-…`) y reinicia: la lista de shows y la página del público cargan GA4. El panel del operador, el simulador y el QR no. Sin la variable no se carga nada de Google.

- **Privacidad:** se usa el modo de consentimiento de Google. Mientras la persona no acepta el aviso, GA4 no guarda cookies. Nunca se envían datos personales.
- **Eventos propios** (parámetro `evento_pc` = el show): `entrar_show` (sector y tipo de zona), `senal_debil` (el teléfono pasó a consultas), `color_manual`, `aporte_silla` y `cambiar_ubicacion`.

## Prueba de carga

`tools/carga.js` simula miles de teléfonos conectados a un evento (con su sincronización de reloj) y mide cuánto tarda en llegarles cada cambio de escena:

```
node tools/carga.js --url http://localhost:3000 --evento demo --telefonos 10000 --clave <clave> --minutos 2
```

Opciones: `--modo poll` (teléfonos en modo consultas), `--zona`, `--escenas`, `--reloj-s`, `--muestras`, `--muestras-luego`, `--espera-inicial-ms`. Un solo PC con Windows llega a unas 13.000 conexiones. Contra producción, úsalo solo a propósito: cada teléfono simulado es una conexión real.

Resultados en el recinto del Movistar Arena (32 zonas), 10.000 teléfonos, servidor local, antes y después de los cambios de robustez:

| | Antes | Después |
|---|---|---|
| Teléfonos conectados | 9.552 (448 fallidos) | 10.000 |
| Cambio de escena: llegada p50 / p95 | 1,0–1,4 s / 1,4–1,9 s | 0,2–0,6 s / 0,4–0,7 s |
| Consultas de reloj al servidor | ~1.900 por segundo | ~125 por segundo |
| Reloj: ida y vuelta p95 (en régimen) | 22–274 ms | 3–4 ms |
| CPU del servidor (en régimen) | 14–38 % de un núcleo | 0–7 % |
| RAM | 343 MB | 177 MB |

En modo consultas (3.000 teléfonos cada ~3 s) el cambio llega a todos en un máximo de 3,6 s, sin errores.

## Licencia

Copyright (c) 2026 Javier Julian Muñoz Navarrete.

Pixel Crowd se distribuye bajo la **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**. En resumen (el texto que vale es el de `LICENSE.md`):
- **Se permite** usarlo, estudiarlo y modificarlo con fines **no comerciales**: uso personal, aficionados, acciones de fans sin fines de lucro, educación e investigación, y organizaciones sin fines de lucro, instituciones educativas, públicas o de beneficencia.
- **No se permite** el uso comercial (por ejemplo, venderlo como servicio, cobrar por montar shows con él o integrarlo en un producto comercial) sin una licencia aparte del titular.
- Quien lo redistribuya debe incluir estos términos y la línea `Required Notice:` de `LICENSE.md`.

**Licencias comerciales y contratación del servicio** (productoras, bandas, eventos con fines de lucro): escribe a **[javier_munoz_navarrete@hotmail.com](mailto:javier_munoz_navarrete@hotmail.com)**.

Las librerías de terceros en `public/vendor/` conservan sus propias licencias MIT: NoSleep.js (Rich Tibbett) y qrcode-generator (Kazuhiko Arase).
