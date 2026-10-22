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
Variables: `PORT` (por defecto 3000), `CLAVE_ADMIN` (clave general; tiene prioridad sobre `clave-admin.txt`), `CLAVE_EVENTO_<SLUG>` (clave de un evento), `URL_PUBLICO` (dirección base para los QR, p. ej. el dominio de Railway) y `ABRIR_NAVEGADOR` (abre las pestañas al arrancar).

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

## Cómo funciona

1. Cada teléfono sincroniza su reloj con el servidor (`/api/time`, estilo NTP) cada 30 s.
2. El operador aplica una **capa** (efecto + parámetros) a una o varias zonas. El servidor la programa unos 300 ms en el futuro y la difunde por Server-Sent Events.
3. Cada teléfono calcula **localmente** su color en cada cuadro con `colorEn(capa, posición, horaServidor)` (en `public/show.js`). No hay mensajes por cuadro, todos cambian a la vez y, si la red se cae, el efecto en curso sigue corriendo.

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

Eventos actuales: `babymetal-2026` (Movistar Arena, 3 dic 2026) y `ensayo-caupolican` (oculto, para probar el Teatro Caupolicán).

**BABYMETAL · 3 dic 2026, Movistar Arena** (`data/eventos/babymetal-2026/evento.json`): presets en el orden del setlist de la gira 2026, con los colores de la banda (rojo, negro y blanco):
- **Bandera de Chile** (destacada): **una sola bandera gigante con todo el público**, vista desde el escenario. Cada persona se proyecta según cómo la ve la banda (ángulo horizontal y altura estimada por nivel y fila) y la bandera se reparte por cantidad de gente: la mitad que se ve más arriba forma la franja blanca y el cantón, y la de abajo la roja. El simulador tiene una "Vista desde el escenario" para revisarla.
- **Banderas por sector**: una bandera en cada galería (vista desde la cancha) y otra en la cancha.
- **Tela roja BABYMETAL**: efecto "Tela al viento", una gran tela de un solo color que flamea solo con tonos del mismo color (oscuro en los valles, pleno en las crestas y un leve brillo como satín). En la pestaña General está "Tela al viento (color elegido)", que usa el color seleccionado en el panel.
- **Bandera flameando**: la bandera grande como tela al viento. Las ondas nacen en el asta (lado del cantón) y viajan a la punta, hay pliegues con luz y sombra, y los bordes flamean. En el efecto "Bandera", la velocidad es la fuerza del viento (0 = quieta, 20 = brisa, 40 = viento fuerte).
- BABYMETAL DEATH → destellos rojos · Megitsune → zorros 🦊 y "KITSUNE" en mosaico · Monochrome → onda blanca lenta · METALI!! → ola roja · RATATATA → arcoíris rápido · Gimme Chocolate!! / Headbangeeeeerrrrr!!!!! → pulsos al tempo · Road of Resistance → "CHILE 🦊 BABYMETAL" en las galerías, entre otros.

El orden y los BPM son una referencia: hay que ajustarlos en el ensayo y con el setlist real de Santiago. Por seguridad, ni el estrobo ni el pulso superan 3 ciclos por segundo, pida lo que pida el preset.

## Recintos

Cada recinto vive en `data/recintos/<nombre>/` y cada evento indica cuál usa (`"recinto"` en su `evento.json`). Varios eventos pueden compartir un recinto.

| Recinto | Contenido |
|---|---|
| `movistar-arena` | Movistar/Santander Arena: cancha de pie en **4 sectores de luz** (C1–C4, cada uno con su cuadrícula 3×3: 36 celdas), 12 sectores de Platea Baja (B1–B12), 14 de Platea Alta (A1–A14) y Tribuna 1–2 (T1–T2), con **8.027 asientos**. |
| `teatro-caupolican` | Teatro Caupolicán: **18 zonas sin numerar** con su forma real. Cancha en 4 cuadrantes (C1–C4), Palcos B–E, Platea Baja en 5 tramos (B1–B5) y Platea Alta en 5 tramos (A1–A5). |
| `demo` | Estadio de ejemplo (3 galerías, 3.240 asientos). Lo usan los tests. |

Archivos:
- `recinto.json`: sectores (`numerada` o `general`), rectángulo de las zonas generales y escenario. Una zona general puede traer además su forma (`puntos`), sus 9 subzonas ya calculadas, su altura estimada y textos propios para la cuadrícula (p. ej. "Filas de abajo" en una gradería).
- `asientos.csv`: `sector,fila,asiento,x,y[,col]` en metros, con el escenario en `y = 0` y `x = 0` al centro. `col` (opcional) es la columna real del asiento en la grilla vista desde la cancha, con pasillos incluidos, para que los mosaicos respeten la geometría.

### Cómo se obtuvo el Movistar Arena
`tools/importar-puntoticket.js` convierte `puntoticket-crudo.json`, que contiene las grillas de asientos extraídas a mano y lento del selector de PuntoTicket de un evento con todas las ubicaciones abiertas. Cada sector del plano trae en su id el giro (`R`) con que PuntoTicket dibuja la grilla; deshaciendo ese giro se ubica cada asiento en el plano.

Limitaciones conocidas:
- **839 asientos (10,7 %) tienen número deducido**: eran filas completamente vendidas en el evento de referencia y el sitio no muestra sus números. Se toman de la fila vecina, porque la numeración avanza por columna en el 94 % de los casos. Hay que verificarlos con entradas reales.
- **Tribuna** se sacó de otro evento (DGM179), donde sí está habilitada: 2 filas de 40 asientos por sector. Tribuna 1 numera 1–40 y Tribuna 2 41–80, deducido de los pocos asientos libres. La fila A de Tribuna 1 no tenía ningún número visible y se asumió igual que la B.
- Los nombres B1–B12 / A1–A14 son propios (en sentido horario desde el escenario); Tribuna 1 y 2 son los nombres oficiales. En la web del público cada persona **toca su sector en el mapa**, así no necesita saber el nombre oficial.

### Cómo se obtuvo el Teatro Caupolicán
En el teatro las plateas se venden **sin asiento numerado** (y en el evento de referencia los palcos estaban agotados), así que no hay grilla de asientos que extraer. `tools/importar-caupolican.js` parte del plano de bloques del selector de Puntoticket (evento ZZ Top, EFF031), que se abrió una sola vez: cada sector del SVG se rasterizó dentro de la página (`puntoticket-mascaras.json`) y se convirtió en zonas con su forma real.
- Cada anillo de platea se corta en 5 tramos según el ángulo desde el centro de la cancha.
- Las 9 celdas de cada zona se reparten por cantidad de puntos: filas de abajo, del medio y de arriba (según la distancia a la cancha) × izquierda, centro y derecha (vistas por alguien sentado mirando hacia la cancha).
- **Aproximaciones:** la escala (~0,3 m por unidad del plano; no hay medidas oficiales) y las alturas de las plateas, que solo se usan para la bandera gigante.

### Números de silla aportados por el público
Donde no hay mapa numerado (las graderías y palcos del Caupolicán, o cualquier zona general con sillas), la persona elige su zona y su celda y, **de forma opcional**, anota la fila y el número que ve en su silla. Así, después de uno o más shows, tenemos datos reales para reconstruir el mapa numerado aunque no consigamos el plano oficial.
- Se guardan **por recinto** en `aportes/<recinto>.jsonl` (o en la carpeta de `DATA_APORTES`): fecha, evento, zona, celda, fila, número y una huella anónima del teléfono (para no contar dos veces). Sin nombre, teléfono ni IP.
- Límite de 20 envíos por IP cada 10 minutos. El envío no bloquea el show: si no hay red, la pantalla se enciende igual.
- En el panel del operador, "Números de silla aportados" muestra el resumen por zona y celda (cuántos aportes, rango de números, filas vistas) y descarga todo en CSV.
- En Railway, la carpeta debe estar en un **volumen persistente**; si no, los aportes se pierden al redesplegar.

`npm run recinto-demo` regenera el estadio de ejemplo.

## Límites del prototipo (pendiente para producción)

- **Escala:** un proceso Node con SSE aguanta unos pocos miles de conexiones. Para un estadio hay que pasar a un broadcast distribuido (Cloudflare Durable Objects, Ably, Pusher o un clúster con Redis pub/sub) con CDN.
- **Show precargado:** hoy los efectos se lanzan en vivo. Lo siguiente es una línea de tiempo por canción descargada antes del show, que solo necesite la señal de "arranca".
- **Brillo y linterna:** la web no puede subir el brillo ni usar la linterna en iPhone. Eso requiere app nativa.
- **Recintos curvos:** la grilla del mosaico usa el orden de los asientos dentro de cada fila. En galerías muy curvas conviene proyectar por coordenadas.

## Licencia

Copyright (c) 2026 Javier Julian Muñoz Navarrete.

Pixel Crowd se distribuye bajo la **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**. En resumen (el texto que vale es el de `LICENSE.md`):
- **Se permite** usarlo, estudiarlo y modificarlo con fines **no comerciales**: uso personal, aficionados, acciones de fans sin fines de lucro, educación e investigación, y organizaciones sin fines de lucro, instituciones educativas, públicas o de beneficencia.
- **No se permite** el uso comercial (por ejemplo, venderlo como servicio, cobrar por montar shows con él o integrarlo en un producto comercial) sin una licencia aparte del titular.
- Quien lo redistribuya debe incluir estos términos y la línea `Required Notice:` de `LICENSE.md`.

**Licencias comerciales y contratación del servicio** (productoras, bandas, eventos con fines de lucro): escribe a **[javier_munoz_navarrete@hotmail.com](mailto:javier_munoz_navarrete@hotmail.com)**.

Las librerías de terceros en `public/vendor/` conservan sus propias licencias MIT: NoSleep.js (Rich Tibbett) y qrcode-generator (Kazuhiko Arase).
