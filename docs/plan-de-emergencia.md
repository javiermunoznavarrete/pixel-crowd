# Plan de emergencia para el día del show

Qué hacer, en orden, si algo anda mal durante un show. Las claves y secretos **no** están en este repositorio: la clave del administrador está en `clave-admin.txt` (en el PC del operador, fuera de git) y en Railway (`CLAVE_ADMIN`); el secreto de origen solo en Railway (`ORIGEN_SECRETO`) y en Cloudflare.

## Dos shows, dos operadores

La noche del 3 de diciembre hay un operador por concierto. Cada uno recibe **la clave de su show**: solo sirve para ese show (no ve ni controla el otro, ni puede expulsar a nadie).

| Quién | Clave | Dónde está | Qué puede hacer |
|---|---|---|---|
| Operador de BABYMETAL | clave del show | `data/eventos/babymetal-2026/clave.txt` y Railway `CLAVE_EVENTO_BABYMETAL_2026` | Solo el panel de BABYMETAL |
| Operador de ATARASHII GAKKO! | clave del show | `data/eventos/atarashii-gakko-2026/clave.txt` y Railway `CLAVE_EVENTO_ATARASHII_GAKKO_2026` | Solo el panel de ATARASHII GAKKO! |
| Supervisor (Javier) | clave general | `clave-admin.txt` y Railway `CLAVE_ADMIN` | Los dos shows, y cerrar las sesiones de los demás |

Cada operador entra en **https://pixelcrowd.cl/admin** con su clave y llega directo al panel de su show. Si un operador pierde la conexión o el teléfono, el supervisor puede operar ese show con la clave general desde /admin.

Si se sospecha que la clave de un show se filtró: cámbiala en Railway (`CLAVE_EVENTO_…`). Ojo: cambiar cualquier variable reinicia el servidor y **cierra las sesiones de todos**, así que los dos operadores deben volver a entrar.

## Antes del show (la tarde del 3 de diciembre)

1. Entra a **https://pixelcrowd.cl/admin** desde el teléfono y el PC del operador **antes** de llegar al recinto. La sesión dura 12 horas, así que no dependes de la señal del recinto para ingresar la clave.
2. Ten un segundo operador de respaldo con la misma clave, en otra parte del recinto y, si se puede, con otra compañía de teléfono.
3. Abre la página de cada show una vez en el teléfono del operador: queda guardada para abrir sin señal.

## Si sospechas que alguien más entró al panel

1. En **/admin**, toca **Cerrar las demás sesiones**. Todos los paneles y simuladores abiertos con otras sesiones se desconectan al instante; el tuyo sigue.
2. Cambia la clave (abajo). Hasta que lo hagas, quien la tenga puede volver a entrar.

## Cambiar la clave del administrador (2 minutos)

1. Railway → proyecto **pixel-crowd** → servicio → **Variables** → `CLAVE_ADMIN` → nueva clave larga.
2. Railway redespliega solo (unos 40 segundos). Al reiniciar, **todas** las sesiones se cierran: vuelve a entrar con la clave nueva en /admin.
3. Actualiza `clave-admin.txt` en el PC del operador.

Los teléfonos del público no se ven afectados: siguen con el efecto que tenían y reconectan solos.

## Si el sitio está lento o caído

| Síntoma | Qué mirar | Qué hacer |
|---|---|---|
| El panel no conecta | Railway → servicio → Deployments | Si el último falló, **Rollback** al anterior |
| Muchos teléfonos "con señal débil" | Es la red del recinto, no el servidor | Nada: el show sigue con lo que ya recibieron |
| Ataque de tráfico (miles de pedidos raros) | Cloudflare → pixelcrowd.cl → Analytics y Security → Events | Ver abajo |

### Ataque de tráfico

El servidor ya limita conexiones y pedidos por IP, y Cloudflare frena la fuerza bruta en el login. Si aun así un ataque satura el sitio:

1. Cloudflare → pixelcrowd.cl → **Security** → **Events**: identifica la IP o el país de origen.
2. **Security → WAF → Custom rules**: crea una regla que bloquee esa IP (o ese país, si no es Chile).
3. Último recurso: **Under Attack Mode** (Overview → Quick Actions). Muestra una verificación de unos 5 segundos a cada visitante. Los teléfonos que ya tienen la conexión abierta siguen recibiendo el show, pero sus consultas de respaldo y de reloj pueden fallar, y los que entren después tardan más. Desactívalo apenas pase el ataque.

## Qué protege a la app hoy

- Todo el tráfico entra por Cloudflare: el servidor rechaza los pedidos que no traen la cabecera secreta que agrega Cloudflare (`ORIGEN_SECRETO`), así que nadie se salta su protección entrando por la dirección de Railway.
- Login: bloqueo por IP real del visitante, cada vez más largo (1, 5, 15 y 60 minutos), demora en cada clave incorrecta y límite de Cloudflare de 10 intentos en 10 segundos por IP. Un intruso no puede bloquear el ingreso de los demás.
- Clave del administrador aleatoria de 20 caracteres.
- Topes de conexiones en vivo y de pedidos por IP y en total, generosos para no afectar a los teléfonos que comparten IP en la red de la compañía.
- Política de contenido (CSP) que solo ejecuta los scripts de la app, ninguna página se puede incrustar en otro sitio y las sesiones del panel no se guardan en cookies (no hay ataques de formularios falsos).
- El público no necesita cuenta: no hay datos personales que robar.
