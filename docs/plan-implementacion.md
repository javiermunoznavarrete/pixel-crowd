# Plan de implementación: del prototipo LAN a la acción de fans

## Estado al 22 de octubre de 2026

El plan original (más abajo) suponía Cloudflare. Terminamos en **Railway, sin CDN**, con dos shows la misma noche (Movistar Arena y Teatro Caupolicán). Antes de cambiar el transporte se midió con `tools/carga.js` (10.000 teléfonos simulados; resultados en el README):

- **Transporte:** se mantiene **SSE** como vía principal. Sin CDN, 20.000 teléfonos consultando cada 3 s serían ~7.000 consultas/s contra un solo servidor, mientras que SSE entrega cada cambio con una sola escritura por teléfono. El **polling queda como respaldo automático** para los teléfonos cuya red no sostiene la conexión (§2.2 con `ETag`, jitter y backoff). Railway corta las conexiones a los 15 min y quizá tras 60 s sin datos: EventSource reconecta solo y el servidor manda una señal de vida cada 16 s.
- **El cuello de botella real era el reloj:** 6 consultas cada 30 s por teléfono (~1.900 consultas/s con 10.000). Ahora: espera inicial al azar, re-sincronización cada ~4 min con 3 muestras, `performance.now()` y cada respuesta de `/estado` sirve de muestra (§2.3). Resultado: ~125 consultas/s y ±3 ms de ida y vuelta.
- **Estado compacto:** cada capa viaja una vez aunque la usen 32 zonas, y se serializa una sola vez por cambio (antes, una vez por teléfono). Con el Movistar Arena el cambio llega 3 veces más rápido.

| # | Punto del plan | Estado |
|---|---|---|
| 1 | Modelo de cues con cola | ✅ Cola por zona con `inicio`; secuencias con `pasos` |
| 2 | Transporte | ✅ SSE + polling de respaldo (ver arriba) |
| 3 | Reloj monotónico y re-sincronización | ✅ |
| 4 | Admin para teléfono | ✅ Paneles plegables; botón Cortar secuencia |
| 5 | Setlist precargado | ✅ Motor listo y ejemplo en `demo`; faltan los tiempos reales de cada canción |
| 6 | Service worker | ✅ `public/sw.js`, red primero con respaldo guardado |
| 7 | Botón manual de respaldo | ✅ Color manual en el panel del show; aviso tras 30 s sin señal |
| 8 | Telemetría | ⏸ No se hizo: el panel ya cuenta teléfonos por zona y por tipo de conexión |
| 9 | Mapa del recinto | ✅ Movistar Arena y Teatro Caupolicán (repositorio privado) |
| §3.5 | Cues idempotentes y segundo admin | ✅ Id por envío y 4 reintentos |
| — | Prueba de carga | ✅ Local con 10.000; falta una prueba contra Railway |

Cruza el brief técnico (red celular, admin en el público, Santander Arena, ~15.500 personas) con el prototipo actual.

## 1. Qué del brief ya está hecho en el prototipo

| Brief | Prototipo | Estado |
|---|---|---|
| Estado determinista: `pattern(params, ubicación, t)` | `Show.colorEn(capa, pos, t)` en `public/show.js` | ✅ Igual |
| Cambios programados a futuro (`start_at`) | `capa.inicio` + reproductor con capa anterior hasta el inicio | ✅ Igual |
| Reloj con 6–8 muestras, la de menor RTT | `sincronizarReloj()` | ✅ (falta usar `performance.now()`) |
| Tope de destellos en el cliente | `MAX_HZ_ESTROBO = 3`, aplicado en cliente y servidor | ✅ |
| Ubicación guardada en `localStorage` con try/catch | Sí | ✅ |
| **[ABIERTO] Cómo ubicar a la gente en cancha** | Cuadrícula 3×3 (adelante/medio/atrás × izq/centro/der) | ✅ Resuelto |
| Ubicación → coordenadas `(x, y)` | `data/asientos.csv` + `prepararRecinto()` + grilla para mosaicos | ✅ Solo falta el mapa real |
| Wake Lock + re-solicitar al volver | NoSleep.js: Wake Lock si hay HTTPS, video invisible si no | ✅ Mejor que el brief (cubre más casos) |
| QR / link | Página `/conectar` | ✅ |

## 2. Qué cambia (lo que hay que construir)

| # | Cambio | Por qué |
|---|---|---|
| 1 | **Modelo de cues**: cola con `start_at`, `duration_ms`, `targets`, `fallback`, `v`, `mode`, `next_poll_ms` | Hoy hay una capa por zona sin duración ni cola. La cola permite precargar los próximos cues y seguir sin red. |
| 2 | **Transporte por polling** (reemplaza SSE) con `next_poll_ms`, jitter de ±20 %, backoff exponencial y `ETag` | SSE mantiene una conexión abierta por teléfono, lo que no escala a 15.500 personas sin un servidor dedicado. El polling a un JSON en CDN cuesta casi nada. |
| 3 | **Reloj monotónico** con `performance.now()` + offset; re-sincronizar cada 3–5 min y tras reconectar | La hora del sistema del teléfono puede saltar por un ajuste automático. |
| 4 | **Admin para teléfono**: botones grandes, armar/desarmar, cues por canción, reintentar | El panel actual está pensado para PC. |
| 5 | **Setlist precargado** (`setlist.json`): secuencia de cues por canción, con tiempos relativos al inicio | En vivo el admin solo toca "Canción 3 ▶". |
| 6 | **Service worker** que precachee página, motor, mapa y librerías | Si la carga inicial falla en el recinto, la app abre igual. Se difunde el link días antes. |
| 7 | **Botón manual de respaldo** (elegir color si todo falla) | Del brief. |
| 8 | **Telemetría** de 1–2 % de los clientes con `sendBeacon` | Medir el show de prueba. |
| 9 | **Mapa del Santander Arena** en `data/asientos.csv` | Ya está el formato; falta digitalizar. |

Lo que se mantiene: el motor `show.js` completo, la web del público, el simulador (sirve para ensayar el setlist) y `server.js`, que pasa a ser un **emulador local** del contrato de producción para seguir probando en la WiFi de casa.

## 3. Correcciones al brief

### 3.1 El lead time de 4–5 s no alcanza con polling cada 3 s
Peor caso para que un teléfono se entere de un cue:

```
poll máximo (3 s + 20 % jitter)   3,6 s
caché del JSON (max-age=2)        2,0 s
petición en red saturada          ~2,0 s
                                  ─────
                                  ~7,6 s
```

Con un lead de 4–5 s, una parte del público recibe el cue tarde y entra a mitad del efecto. El cálculo determinista lo pone en el punto correcto, pero se nota un arranque disparejo.

**Propuesta:** el lead se calcula a partir de la configuración, `lead = poll × 1,2 + cache_ttl + 2 s`, que con poll de 3 s da **8 s**. Además, los setlists se diseñan para que los primeros segundos de cada efecto toleren llegadas tardías: fundido de entrada y nada de "golpes" en el segundo 0.

### 3.2 R2 + caché: falta una Cache Rule
Según la documentación de Cloudflare, el CDN **no cachea JSON por defecto**: responde `cf-cache-status: DYNAMIC` y cada consulta va a R2. El brief dice que no se usen Cache Rules para el TTL, y eso es correcto: en el plan Free el Edge TTL forzado tiene un mínimo de 2 h. Pero sí hace falta **una** regla:

- **Cache Rule** para `/state.json`: *Eligible for cache = Yes*, **Edge TTL = "Use cache-control header if present"** (`respect_origin`). Así manda el `Cache-Control: public, max-age=2` del objeto y no se fuerza ningún TTL.
- Verificar después que `cf-cache-status` muestre `HIT`/`EXPIRED`/`REVALIDATED` y no `DYNAMIC`.

### 3.3 Si se paga Workers (USD 5), conviene que el Worker sirva el estado
El brief ya concluye que `/time` necesita Workers Paid con el arena lleno. En ese caso:

- El Worker `GET /state` agrega **`X-Now: Date.now()`** a cada respuesta, aunque el cuerpo venga de una caché interna de ~1 s. Entonces **cada poll es una muestra de reloj**, el `/time` separado sobra y la sincronía mejora sola durante el show.
- Se evita toda la configuración de caché de R2.
- Costo: unos 10 M de peticiones con el arena lleno, dentro de los 10 M incluidos o con un excedente de unos centavos.

### 3.4 Decisión de infraestructura según la asistencia (punto abierto)

| Asistencia esperada | Arquitectura | Costo |
|---|---|---|
| Hasta ~3.000 | Pages + R2 con Cache Rule (§3.2) + Worker Free para `/time` y `/admin/cue` | USD 0 |
| Más de ~3.000 o arena llena | Pages + **un Worker Paid** que sirve `/state` con `X-Now` y recibe `/admin/cue` (§3.3) | ~USD 5 |

El cliente se escribe para **los dos casos**: si la respuesta trae `X-Now`, se usa como muestra de reloj; si no, se consulta `/time`.

### 3.5 Admin en red saturada
- **Cues idempotentes**: el `id` lo genera el teléfono del admin, así un reintento no duplica el cue.
- **Segundo admin de respaldo**, con el mismo token, en otra parte del recinto y de otra compañía celular.
- Se puede enviar **la canción completa en un solo POST** (todos sus cues con `start_at` relativos). Si la red cae a mitad de la canción, el resto ya está en los teléfonos.

## 4. Fases

| Fase | Contenido | Resultado verificable |
|---|---|---|
| **1. Contrato y motor** | Modelo de cues (§2.1), reloj monotónico (§2.3), cliente por polling (§2.2) y `server.js` emulando `/state`, `/time` y `/admin/cue` | Tests de cola/fallback/vencimiento; prueba en WiFi de casa con el nuevo transporte |
| **2. Admin móvil y setlist** | Admin táctil (§2.4), `setlist.json` (§2.5), idempotencia y reintento (§3.5), lead calculado (§3.1) | Ensayo de 4 canciones en el simulador desde un teléfono |
| **3. Robustez** | Service worker (§2.6), backoff y `ETag`, botón manual (§2.7), pantalla de instrucciones | Prueba con DevTools: offline, 3G lenta, cortes de 30 s |
| **4. Cloudflare** | Pages + Worker (o R2 + Cache Rule, según §3.4), dominio, token como secreto | `cf-cache-status` correcto; sincronía comparable a la LAN |
| **5. Recinto** | Mapa del Santander Arena en CSV, sectores y formato real de asiento | Selector con secciones reales; mosaico de prueba en el simulador |
| **6. Pruebas de campo** | 5–10 teléfonos grabados en cámara lenta; prueba de carga desde pocas IP; telemetría 1–2 % (§2.8) | Desfase medido entre teléfonos; sin 429 ni desafíos en la carga |

## 5. Fuera de alcance por ahora
- WebSockets con Durable Objects (§11 del brief): solo si el polling no basta. El modelo de cues no cambia.
- Sincronía por audio (§12) y Bluetooth: descartados para la v1.
- Mosaicos de texto: el motor ya los soporta, pero en una acción de fans con participación incierta conviene priorizar colores por sección y olas.

## 6. Puntos abiertos que siguen pendientes
- [ ] Asistencia esperada → define la fila de §3.4.
- [ ] Mapa de sectores y formato de asiento del Santander Arena.
- [ ] Canciones y efecto de cada una (insumo para `setlist.json`).
- [ ] Dominio.
- [x] ~~Ubicación en cancha~~ → cuadrícula 3×3 (ya implementada).
- [x] ~~Hosting de `/time`~~ → resuelto por §3.3/§3.4.
