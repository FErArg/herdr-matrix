# Changelog

Formato: versión y fecha. Versionado semántico.

## 0.25.7 — 2026-10-29

### Añadido

- Orden `new-tab [claude|opencode]` desde la sala de un workspace o de una de sus pestañas. Abre una pestaña nueva en ese workspace y, si se pide, arranca el agente en ella. Pide `confirmar`. Sin tipo, el bot pregunta: 1 opencode, 2 claude, 3 solo pestaña. El directorio sale de un agente ya abierto en el workspace; el mensaje nunca aporta una ruta. Máximo 3 pestañas nuevas por workspace en 10 minutos (`src/new-tab.mjs`).

### Corregido

- El nombre del agente que se arranca en una pestaña nueva se convierte a minúsculas y guiones para cumplir las reglas de Herdr (`agentNameOf`). Sin ese cambio, la pestaña se creaba pero el agente no arrancaba.

## 0.25.6 — 2026-10-29

### Corregido

- Dos pruebas de rotación dependían de la fecha del equipo. La fecha de modificación del fichero de prueba se alinea ahora con el reloj de la prueba. El código de rotación no cambia.

## 0.25.5 — 2026-10-29

### Documentación

- `docs/19-recuperar-dispositivo-bot.md`: sección para cambiar a una cuenta nueva del bot. Hay que quitar `control_room_id`, `rooms` y `tab_rooms` de `config.json` antes de `setup`.

## 0.25.4 — 2026-10-29

### Cambiado

- Chat por pestaña. Una sala de pestaña abre el chat con el agente de su pestaña (`tabId`), aunque el workspace tenga varios agentes. Si la pestaña no tiene agente, no se abre sesión ni se arranca uno en el panel principal; la sala lo indica. La sala de workspace mantiene la regla: con más de un agente en el workspace, no abre el chat (`src/chat.mjs`, `src/inbound.mjs`).
- Las tarjetas y el turno de un agente usan la sesión de la pestaña de su panel (`src/outbound.mjs`).

## 0.25.3 — 2026-10-29

### Cambiado

- `verify` usa siempre comparación de emojis (SAS). Ya no ofrece QR: el cliente del dueño anuncia `m.qr_code.scan.v1` aunque no pueda escanear y la verificación se quedaba esperando.

### Corregido

- Las rutas de transcripción de Claude Code cambian cualquier carácter que no sea letra o dígito por guion, no solo `/` y `.`. Con directorios temporales de macOS el bridge no encontraba la respuesta del agente (`src/transcript.mjs`).

## 0.25.2 — 2026-10-29

### Cambiado

- Las salas de pestaña se crean de una en una, con una espera de 1 s entre acciones (`ACTION_SPACING_MS`).
- Ante un 429 de Synapse, la sincronización de salas de pestaña se pausa 60 s (`RATE_LIMIT_PAUSE_MS`).

## 0.25.1 — 2026-10-29

### Cambiado

- `docs/19-recuperar-dispositivo-bot.md` corregido: `setup` revoca la sesión anterior y borra el almacén, así que `setup --logout` no hace falta antes; la sala de control se conserva si ya existe; reiniciar el bridge no arregla el error de claves de un solo uso.

## 0.25.0 — 2026-10-29

### Añadido

- Salas por pestaña de Herdr (`src/tab-rooms.mjs`). Cada pestaña activa tiene su sala cifrada y privada, con nombre "workspace-pestaña" en minúsculas. Si la etiqueta no tiene caracteres válidos, el nombre usa el número de la pestaña. Se invita al dueño al crearla, se renombra si cambia la pestaña o el workspace, y se archiva al cerrarse. Las salas se guardan en `tab_rooms` de `config.json`.
- Las notificaciones de un panel van a la sala de su pestaña; sin sala de pestaña, a la del workspace.
- El bridge se suscribe a `tab.created`, `tab.closed` y `tab.renamed`, y lee las pestañas con `tab.list`.
- Validación de `tab_rooms` en `src/config-check.mjs`.
- `docs/19-recuperar-dispositivo-bot.md`: procedimiento para recuperar el dispositivo del bot cuando su almacén criptográfico está desincronizado con el servidor.

### Cambiado

- La sala del workspace ya no recibe avisos de los paneles que tienen sala de pestaña.
- Las pestañas que ya existen al primer arranque reciben sala.
- Las salas de pestaña no preguntan por invitados adicionales: el dueño entra en cada una al crearla.
- El archivado de salas se comparte entre salas de workspace y de pestaña (`archiveRoom` en `src/rooms.mjs`).

## 0.24.1 — 2026-10-27

### Cambiado

- Se elimina el lector de la base de datos de opencode (`opencodeDbPath`, `opencodeReplyAfter`, `readOpencodeReply` de `src/transcript.mjs`). Ningún flujo lo usa: el chat, la tarjeta y `detalle` leen la API.

## 0.24.0 — 2026-10-27

### Añadido

- Con `chat.opencode_auto` desactivado, la sala muestra cada permiso que pide opencode. El dueño responde `permitir` (una vez) o `rechazar`. Nunca se guarda una aprobación: `always` no se ofrece desde la sala.
- `cancelar` con opencode interrumpe el turno por la API (`interruptOpencode`), en lugar de enviar Escape al panel.

## 0.23.0 — 2026-10-27

### Cambiado

- La tarjeta y `detalle` de opencode leen el turno desde la API del servicio de fondo (`src/opencode-api.mjs`), no desde la base de datos de opencode. `cambios` lista los ficheros escritos con la herramienta `write`; `problemas`, las herramientas con error.
- Se eliminan `opencodeTurn` y `readOpencodeTurn` de `src/transcript.mjs`.

## 0.22.1 — 2026-10-27

### Añadido

- Con la sesión en pausa, cada mensaje responde que está en pausa y cómo continuar (`confirmar` o `salir`).

### Cambiado

- opencode: la sesión del chat es la que muestra el panel del workspace (`agent_session` de Herdr), no una nueva. Así el mensaje aparece en la TUI. Se toma al abrir el chat y en cada envío.

## 0.22.0 — 2026-10-27

### Añadido

- Transporte de opencode por la API del servicio de fondo (`opencode api`). Sustituye a `opencode run`. La sesión de chat y la TUI comparten la misma sesión de opencode.
- Comprobación del tipo de agente antes de cada envío: si el agente del panel de un workspace cambia (por ejemplo de Claude Code a opencode), el mensaje no se envía, la sesión queda en pausa y la sala lo avisa. La cola se conserva.

### Cambiado

- `open` de un tipo distinto al de la sesión olvida el ID de sesión y el directorio anteriores.
- Un fallo al leer la respuesta después de enviar el mensaje se registra y se avisa como respuesta no leída, no como envío fallido.
- `open("claude")` rechaza un panel con opencode.

## 0.21.4 — 2026-10-27

### Añadido

- Rotación de registros: `audit.log` y `bridge.log` se archivan al superar 10 MB o al cambiar el día, con compresión gzip. Revisión cada 60 s.

### Cambiado

- `chat` con una sesión ya abierta en la sala responde que la sesión está abierta y no se envía al agente.

## 0.21.3 — 2026-10-27

### Cambiado

- Sin cambios de código: reorganización de la documentación interna de planes.

## 0.21.2 — 2026-10-27

### Corregido

- Sesiones de chat que se cerraban solas: con un agente ya abierto pero ocupado, la sesión fallaba tras 90 s de espera y había que volver a escribir `chat`. Ahora la sesión se abre sin esperar: la instrucción de formato va al principio de la cola y se envía cuando el agente esté libre. La espera de listo solo se aplica a un agente que el bridge arranca.

## 0.21.1 — 2026-10-27

### Corregido

- Tarjeta de tarea: el pedido mostraba las etiquetas internas de Claude Code cuando el turno empezaba con una orden con barra. Ahora usa el nombre del comando y sus argumentos.

## 0.21.0 — 2026-10-27

### Añadido

- Consultas de la tarjeta de tarea, solo con sesión de chat abierta en la sala:
  - `detalle [n]`: últimas n acciones de herramienta del turno (por defecto 10, máximo 30).
  - `ver`: respuesta completa del turno, troceada.
  - `cambios`: ficheros sin confirmar y resumen de diff del proyecto.
  - `cancelar`: envía Escape al panel de la sesión, previa confirmación con `confirmar`.
- `src/consultas.mjs`: análisis de la orden, formato de las respuestas y consulta a git.

### Cambiado

- Con sesión de chat abierta, las consultas y la confirmación de `cancelar` se atienden antes de enrutar el mensaje al agente. Cualquier otro mensaje cancela la orden pendiente.

## 0.20.0 — 2026-10-27

### Añadido

- Tarjeta de tarea en la sala del workspace: se abre al empezar a trabajar un panel con sesión de chat abierta, muestra la decisión pendiente y se cierra con el resultado (pedido, estado, respuesta, cambios y problemas). Se edita el mismo mensaje (`m.replace`).
- Persistencia de tarjetas en `cards.json`, con reintento de edición y cierre `interrumpida` tras reiniciar el bridge.
- `src/transcript.mjs`: lectura del turno completo (pedido, respuesta, ficheros editados y errores), para Claude Code y opencode.

### Cambiado

- El resumen al terminar de 0.19.0 se retira; la tarjeta lo sustituye.

### Seguridad

- El `session_id` que llega de Herdr se valida antes de construir la ruta de la transcripción.
- Redacción de secretos en pedido, respuesta, ficheros, errores y líneas del panel.
- Las tarjetas solo se editan en la sala donde se abrieron, y solo mensajes enviados por el bridge.

## 0.19.1 — 2026-10-27

### Cambiado

- Sin cambios de código: reorganización de la documentación interna de planes.

## 0.19.0 — 2026-10-27

### Añadido

- Resumen al terminar: si un workspace con sesión de chat abierta pasa a `done`, el bridge publica en su sala el último texto del agente. Sin sesión de chat no se publica nada. (Lo sustituye la tarjeta de 0.20.0.)
- Lectores del último turno para Claude Code y opencode.

### Corregido

- Los IDs de workspace de Herdr con letras (`wA`, `wB`) se rechazaban y el bridge no arrancaba tras reiniciarse. La regla ahora acepta `w` seguido de caracteres alfanuméricos.

## 0.18.2 — 2026-10-26

### Añadido

- Licencia GNU GPL v3: archivo `LICENSE` con el texto oficial y `"license": "GPL-3.0-only"` en `package.json`.
- `docs/post`: artículo explicativo del plugin (en español) para el blog.
- README: sección de instalación de `install.sh` y `uninstall.sh` (reenlace, `--purge`, avisos de directorios antiguos), y de cómo funciona el chat con Claude Code y con opencode.
- README: órdenes `chat`, `salir` y `descartar`, y comportamiento de la cola tras reiniciar el bridge.

### Cambiado

- README traducido al inglés. Versión e información de directorios actualizadas a las rutas de Herdr.

## 0.18.1 — 2026-10-26

### Corregido

- Chat de opencode: `opencode run` se ejecutaba en el directorio del bridge (`herdr-matrix`), no en el del workspace. Ahora `runOpencode` recibe `cwd` y toma el directorio del agente del workspace. Sin directorio, no lanza nada.
- Chat por salas: el agente se buscaba en el panel `<workspace>:p1`. Ahora se toma el agente cuyo `workspace_id` coincide con la sala. Un agente de otro workspace nunca responde. Si hay más de un agente en el workspace, el chat no se abre.

### Añadido

- README e `install.sh`: aviso de que el proyecto del workspace debe tener el agente abierto; si no, el chat no responde.
- Pruebas: agente de otro workspace ignorado, panel tomado del workspace, ambigüedad con dos agentes, y `runOpencode` sin directorio.

### Verificado

- `npm test`: 154 de 154 pruebas pasan.
- `shellcheck` sin avisos en `install.sh`.
- Bridge reiniciado con el código nuevo.

### Pendiente

- Prueba en vivo desde Element: un workspace sin agente no responde; uno con agente responde solo en su sala.
- `FILEMAP.md`, `ARCHITECTURE.md` y `SECURITY.md` no existen en el repositorio; no se han actualizado.

## 0.18.0 — 2026-10-26

### Añadido

- Aviso «terminó» cuando un agente pasa de `working` a `idle`. Herdr no siempre marca `done` (p. ej. opencode), así que `kindOf` en `src/notifier.mjs` lo trata como `done`. Usa el mismo `notify_events` y el mismo límite de 10 s por panel.
- `test/notifier.test.mjs`: 2 pruebas nuevas (working → idle avisa como `done`; idle sin trabajo previo no se marca como `done`).

### Cambiado

- Las sesiones de Claude Code también avisan al terminar cada turno. Puede haber más mensajes en sus salas.
- Versión en `package.json`, `package-lock.json` y `herdr-plugin.toml`.

### Verificado

- `npm test`: 148 de 148 pruebas pasan.
- Bridge reiniciado con `startup` (PID 89694).

### Pendiente

- Confirmar en vivo el aviso de `opencode` en `<workspace>` al terminar una tarea.
- Revisar si el ruido de las salas de Claude Code es aceptable.
- Un mensaje llegado a la sala `herdr-matrix` tras escribir en `<workspace>` no tiene evidencia de error de enrutado (la auditoría no muestra órdenes de esa sala). Probablemente era el aviso de la sesión de `herdr-matrix`; hay que confirmarlo.
- `FILEMAP.md`, `ARCHITECTURE.md` y `SECURITY.md` no existen en el repositorio; no se han actualizado.

## 0.17.2 — 2026-10-26

### Corregido

- Chat con un agente: el mensaje mostraba `no se pudo enviar el mensaje al agente: Herdr no respondió a agent.prompt` aunque el agente sí recibía el texto. Causa: el cliente de Herdr cortaba a los 10 s, pero `agent.prompt` espera hasta que el agente quede inactivo (hasta 15 min). Herdr registraba `client_disconnected`.
- `src/herdr.mjs`: `callHerdr` y `request` aceptan un `timeoutMs` opcional. Sin valor, sigue usando 10 s.
- `src/chat.mjs`: `agent.prompt` espera `PROMPT_TIMEOUT_MS + 30 s` en el cliente, más que la espera del agente.

### Verificado

- `npm test`: 146 de 146 pruebas pasan.

### Pendiente

- Prueba del chat con un agente real desde Element tras el reinicio del bridge.
- `FILEMAP.md`, `ARCHITECTURE.MD` y `SECURITY.md` no existen en el repositorio; no se han actualizado.

## 0.17.1 — 2026-10-26

### Cambiado

- `scripts/install.sh`: reenlaza siempre el plugin (`unlink` + `link --enabled`) para que Herdr registre el manifiesto actual con el `[[startup]]`. Antes, si el plugin ya estaba registrado, no se reenlazaba y el arranque automático no aparecía. Exporta `HERDR_PLUGIN_CONFIG_DIR` y `HERDR_PLUGIN_STATE_DIR` con los directorios de Herdr, para que `setup` escriba donde los lee el arranque. El mensaje final muestra los `export` necesarios para `verify` y `run`. (commit `7ac1be6`)
- `scripts/uninstall.sh`: usa los mismos directorios que `install.sh`. `setup --logout` revoca y borra la sesión que usa el bridge, no una copia antigua. La comprobación de `bridge.lock` y `--purge` actúan sobre los directorios de Herdr. Si existen las rutas antiguas (`~/.config/herdr-matrix`, `~/.local/state/herdr-matrix`), avisa, pero no las borra.
- Versión en `package.json`, `package-lock.json` y `herdr-plugin.toml`.

### Verificado

- `install.sh` ejecutado de verdad: reenlaza el plugin y el manifiesto registrado incluye `startup` (0.17.0 en el momento de la prueba).
- `uninstall.sh` con un `herdr` falso y directorios temporales: sin `--purge` conserva `config.json`; con `--purge --yes` borra solo los directorios de Herdr; `--purge` sin `--yes` en modo no interactivo se niega.
- `bash -n` y `shellcheck` sin avisos en ambos scripts.

### Pendiente

- Revocación real de la sesión con `uninstall.sh` contra el servidor Matrix (no probada, porque desconectaría el bot).
- Borrado manual de las copias antiguas de `~/.config/herdr-matrix` y `~/.local/state/herdr-matrix`, si ya no se necesitan.
- `FILEMAP.md`, `ARCHITECTURE.md` y `SECURITY.md` no existen en el repositorio; no se han actualizado.

## 0.17.0 — 2026-10-26

### Añadido

- Arranque automático con Herdr: `[[startup]]` en `herdr-plugin.toml` ejecuta `node src/index.mjs startup`. El comando lanza `node src/index.mjs run` como proceso desacoplado (`detached`, con `unref`) y termina. La salida va a `state/bridge.log` (0600).
- `src/startup.mjs`: no lanza nada si falta `config.json` o `session.json` (lo indica en el log), ni si `bridge.lock` tiene un PID vivo.
- `src/lock.mjs`: `isLocked(path)` comprueba el bloqueo sin tomarlo.
- `test/startup.test.mjs`: 4 pruebas (sin configuración, bridge ya en ejecución, lanzamiento desacoplado con permisos 0600, fallo al lanzar).

### Cambiado

- README: párrafo sobre el arranque automático.
- `scripts/install.sh`: el mensaje final indica que los comandos deben ejecutarse desde el directorio del plugin, con `cd` incluido.
- Versión en `package.json`, `package-lock.json` (que estaba en 0.15.0) y `herdr-plugin.toml`.

### Verificado

- `npm test`: 146 de 146 pruebas pasan.
- `node src/index.mjs startup` sin configuración: avisa y sale con código 0.
- Prueba con configuración inválida: el lanzador sale con 0, el bridge arranca en segundo plano, escribe el error de validación en `bridge.log` y termina.

### Pendiente

- Probar el arranque con Herdr real: que el bridge siga vivo tras reiniciar Herdr, con una configuración válida y conectada a Matrix.
- Confirmar cuándo lanza Herdr el `[[startup]]` (la documentación indica "una vez por plugin habilitado, tras restaurar la sesión").
- `FILEMAP.md`, `ARCHITECTURE.md` y `SECURITY.md` no existen en el repositorio; no se han actualizado.

## 0.16.0 — 2026-10-26

### Añadido

- `scripts/install.sh`: comprueba sistema (Darwin o Linux), Node ≥ 22, npm y Herdr (mínimo según `min_herdr_version`). Ejecuta `npm ci --ignore-scripts`, enlaza el plugin con `herdr plugin link --enabled` y lista los pasos siguientes. Con `--setup`, lanza la configuración interactiva.
- `scripts/uninstall.sh`: se niega a continuar si el bridge está en ejecución. Revoca la sesión en el servidor (`setup --logout`), desenlaza el plugin y conserva la configuración. Con `--purge` borra configuración y estado tras confirmar; `--yes` omite la confirmación. Nunca borra el repositorio.

### Cambiado

- README: sección de instalación con los dos scripts.
- `docs/17-prueba-macos.md`: nombre del instalable de ejemplo a 0.16.0.

### Verificado

- Sintaxis y `shellcheck` de ambos scripts sin avisos.
- `scripts/install.sh --help` y opción inválida (código 2).
- `scripts/uninstall.sh`: purga sin confirmación interactiva se niega; purga con `--yes` sobre directorios temporales funciona; ruta insegura (`$HOME`) se rechaza.
- No se ejecutó la instalación ni la desinstalación completas contra Herdr ni contra un servidor Matrix.

### Pendiente

- Probar `install.sh` y `uninstall.sh` en un Mac real y en Linux.

## 0.15.0 — 2026-10-26

### Añadido

- Soporte declarado para macOS: `platforms` en `herdr-plugin.toml` incluye `macos`. La validación en un Mac real sigue pendiente (`docs/17-prueba-macos.md`).

### Cambiado

- README: requisitos indican Linux o macOS. Versión corregida (decía 0.8.0).
- `docs/05-preguntas.md`: pregunta 21 (sistema operativo) resuelta.
- `docs/17-prueba-macos.md`: estado pendiente de validación en Mac.
- `package-lock.json`: versión de la raíz actualizada de 0.5.0 a 0.15.0 (commit `f1eeddef426ffd95d609203d209de48d83abe818`).

### Verificado

- `npm ci --ignore-scripts` y `npm test`: 142 pruebas pasan. Las pruebas usan servidores y clientes simulados; no prueban Herdr ni Synapse reales.

### Pendiente

- Validación en macOS real según `docs/17-prueba-macos.md`: `setup`, `verify`, `run`, `estado` y `setup --logout`.

## 0.14.2 — 2026-10-26

### Cambiado

- `opencode run` no termina aunque la respuesta ya esté guardada. El bot ahora mira la base mientras el proceso corre y, cuando aparece la respuesta, la publica y cierra el proceso.
- Registro de cada llamada a opencode: inicio, fin o fallo con los segundos.

### Verificado

- Prueba con binario falso: la llamada se resuelve con el ID de sesión sin esperar al fin del proceso.
- En vivo: el modelo respondió, pero el proceso quedó colgado hasta el límite de 3 min.

### Verificado en vivo (extremo a extremo)

- `chat opencode` + `confirmar`, mensaje a opencode, respuesta en 8 s, y `salir` con aviso de cierre.

### Rama

- Cierre de `plugin-base`: fusionada en `main` (avance rápido) y archivada en remoto como `archived/plugin-base`. Sin cambios de código desde 0.14.2; la versión no cambia.

### Pendiente

- 142 pruebas.

## 0.14.1 — 2026-10-26

### Cambiado

- Chat de opencode: sin instrucción de formato al abrir. La instrucción hacía que el modelo respondiera con basura de herramientas, y la primera llamada quedaba colgada.
- Límite de 3 min por llamada a opencode (antes 15 min).
- Si una llamada falla, el bot avisa en la sala y pasa al siguiente mensaje de la cola.

### Verificado

- Prueba en vivo: el aviso de cierre llegó, las respuestas no (causa: la instrucción de formato colgada). Corregido; pendiente de repetir la prueba.

### Pendiente

- Repetir `chat opencode` de extremo a extremo.
- 141 pruebas.

## 0.14.0 — 2026-10-26

### Añadido

- `chat.opencode_auto` en `config.json` (por defecto `true`): controla `--auto` en `opencode run`. Con `false`, el agente no aprueba permisos automáticamente. Requiere reiniciar el bridge.
- La validación de `config.json` comprueba que `chat` sea un objeto y que `opencode_auto` sea booleano.
- 3 pruebas nuevas. 139 en total.

## 0.13.0 — 2026-10-26

### Cambiado

- Sesiones de opencode: el texto se envía con `opencode run --session <id> --auto --format json <texto>`. El panel del TUI no sirve: el Enter no enviaba el mensaje.
- El lector de opencode lee `session_message` (las versiones recientes y `opencode run`) y, si no hay filas, `message`/`part`.

### Verificado

- Lector sobre una sesión creada con `opencode run`: devuelve la respuesta de cada turno (`prueba`, `segunda`).

### Pendiente

- **Decisión:** `--auto` aprueba permisos sin preguntar. Sin él, `opencode run` no tiene con quién confirmar permisos. Una prueba en vivo con `--auto` fue denegada por el clasificador de seguridad; no se ha ejecutado de extremo a extremo.
- 136 pruebas.

## 0.12.0 — 2026-10-26

### Añadido

- Lector de respuestas para opencode (`readOpencodeReply`): lee `opencode.db` (tablas `message` y `part`). Se verificó con una sesión real de opencode existente.
- `chat opencode` abre opencode; `chat` sigue abriendo claude. Cada sesión recuerda su tipo de agente.

### Pendiente

- **Envío a un agente opencode nuevo no verificado:** `agent.prompt` devolvió `done`, pero el mensaje quedó en la caja de entrada del TUI sin respuesta.
- `node:sqlite` es experimental en Node 22 y muestra un aviso al cargarse.

## 0.11.0 — 2026-10-26

### Añadido

- Chat directo con el agente de un espacio (`src/chat.mjs`, `src/transcript.mjs`): `chat` + `confirmar` abre una sesión; los mensajes van al agente en orden con cola persistente; la respuesta completa se publica en trozos; `salir` cierra la sesión.
- Tras reiniciar, la cola queda en pausa hasta confirmar o descartar.
- Respuesta completa leída de la transcripción de Claude Code (el panel solo muestra lo visible).
- 17 pruebas nuevas (transcripción, cola, espera de preparación, flujo de entrada). 132 en total.

### Verificado en vivo

- Abrir sesión, respuestas en orden, `salir` cierra la sesión y el agente sigue abierto.
- Un fallo real corregido: el formato se enviaba antes de que el agente aceptara entrada.

### Pendiente

- Lector de transcripción solo para Claude Code.
- Respuestas de más de 15 min se pierden; la cola sigue.
- Prueba de reinicio con cola pendiente (no hecha).

## 0.10.1 — 2026-10-26

### Cambiado

- `estado` muestra el nombre del espacio junto al panel: `[demo-agent · w2:p1] working: claude`.
- La confirmación nombra el espacio y el panel: `¿confirmas la orden enviar en demo-agent (w2:p1)?`.
- El ID del panel sigue siendo lo que se usa para escribir; solo cambia el texto.
- 1 prueba nueva. 116 en total.

### Verificado en vivo

- `estado` en la sala de control: la respuesta usa el nuevo formato y la auditoría registra `ok` (2026-10-26, 09:12).

## 0.10.0 — 2026-10-26

### Añadido

- Interpretación determinista de órdenes (`src/commands.mjs`): sinónimos fijos, tildes ignoradas, una letra de error solo en lectura (`estado` y `leer`, palabras de 5 o más letras), panel en formato `w2:p1`, `W2:P1`, `w2.p1` o `w2 p1`, y confirmaciones `sí`, `si`, `ok`, `confirma`, `confirmo`.
- Ninguna interpretación elige un método de Herdr. Las erratas nunca llegan a una escritura.
- 5 pruebas nuevas. 115 en total.

### Pendiente

- Intérprete con modelo de lenguaje: propuesta aparte, con análisis de seguridad propio.

## 0.9.3 — 2026-10-26

### Verificado en vivo

- Entrada (Fase 3): `estado`, `enviar` + `confirmar`, `enter` + `confirmar` y `leer` desde salas reales (`leer` procesado en `ferny`, `w3:p1`).
- Invitación (Fase 2b): respuesta del dueño con un MXID, invitación, aceptación por API de la cuenta de prueba.
- Rechazo: una cuenta sin invitación recibe `403 M_FORBIDDEN` al intentar entrar a la sala de control.

### Documentación

- `docs/12` y `docs/13` actualizados con lo verificado. El contenido publicado por `leer` lo confirmó el dueño en Element.

## 0.9.2 — 2026-10-26

### Añadido

- `verify`: si el cliente del dueño no puede escanear QR, la verificación pasa a emojis (SAS). La consola muestra los siete emojis con su nombre; se confirma con `si` o `no`.
- Límite de 60 s al paso de cross-signing, y mensaje claro si el servidor rechaza la contraseña.

### Verificado

- En vivo: `verify` con emojis, el dueño comparó los emojis en Element y el dispositivo del bot quedó verificado.

### Pendiente

- Cómo se comporta el QR con un cliente que sí pueda escanear (móvil): no probado.

## 0.9.1 — 2026-10-26

### Añadido

- Las preguntas de invitación pendientes se guardan en `state/pending-invites.json` (0600) y se recuperan tras un reinicio. La pregunta activa se vuelve a enviar con 10 min nuevos.
- 3 pruebas nuevas (persistencia y restauración). 110 en total.

### Verificado

- Arranque limpio con la persistencia activa; el bloqueo de instancia única impidió un segundo arranque mientras el primero seguía vivo.

### Pendiente

- Respuesta a una invitación real a un segundo usuario: sin segunda cuenta.

## 0.9.0 — 2026-10-26

### Añadido

- Pregunta de invitado extra en la sala de control al crear una sala de workspace (`src/invites.mjs`). Solo el dueño responde: `no` o un MXID válido y existente, que se invita a la sala del workspace. Una pregunta activa a la vez; caduca a los 10 min sin invitar.
- `inviteUser` en el cliente Matrix (`POST /rooms/{id}/invite`).
- `onCreated` en el gestor de salas: avisa al crear una sala.
- 13 pruebas nuevas (cola de invitaciones y respuesta en la entrada). 107 en total.

### Verificado en vivo

- Un workspace de prueba: sala creada, pregunta enviada a la sala de control (confirmado en el servidor), sala archivada al cerrar el workspace.

### Pendiente

- Respuesta del dueño y la invitación real a un segundo usuario: no hay segunda cuenta.

## 0.8.2 — 2026-10-26

### Cambiado

- El parser ignora caracteres invisibles (ancho cero, BOM, guion blando), normaliza Unicode y ignora la puntuación final: `Confirmar,` y `leer w2:p1.` se aceptan.
- La auditoría de una orden no reconocida registra solo la primera palabra (hasta 20 caracteres, escapada). Antes solo decía "orden no reconocida".

### Verificado

- Pruebas de unidad: puntuación final, carácter de ancho cero en el verbo, `Confirmar,` confirma la acción pendiente, y la auditoría no guarda el resto del mensaje. 98 en total.

### Pendiente

- Causa exacta de una orden rechazada en vivo (`enviar w2:p1 prueba de escritura`): el texto normal se parsea bien. La sospecha es un carácter invisible; con el registro nuevo se verá en la próxima prueba.
- Un texto que termina en puntuación pierde esa puntuación en `enviar` (documentado).

## 0.8.1 — 2026-10-26

### Corregido

- Los listeners de entrada se registran antes de la primera sincronización (`beforeStart` en `startBotClient`). Antes, las órdenes que llegaban justo antes del arranque se perdían sin registro.

### Verificado

- En vivo: `estado` del dueño en la sala de control, enviado antes del arranque, se procesó: auditoría `ok`, respuesta con los agentes de todos los espacios. Y en la sala de un espacio, solo los de ese espacio.

## 0.8.0 — 2026-10-26

### Añadido

- Validación de `config.json` al arrancar (`src/config-check.mjs`). Si falla, el bridge no conecta con Herdr ni con Matrix.
- Supervisor (`src/supervisor.mjs`): reinicio con backoff exponencial (1 s a 60 s), sale tras 5 fallos seguidos, reinicia el contador tras una ejecución estable de 5 minutos. Errores fatales (configuración o sesión ausentes) no se reintentan.
- `README.md` del plugin: instalación, configuración, órdenes, riesgos y rotación.
- Docs: `docs/14-fase4-robustez.md`.
- 12 pruebas nuevas (validación y supervisor). 94 en total.

### Cambiado

- La suscripción de Herdr cerrada es un fallo: el supervisor la reinicia. Antes, el bridge salía normalmente.

### Verificado

- Configuración real validada al arrancar (con el ID de sala corregido, ver abajo). El bridge arranca, y con SIGTERM termina sin dejar bloqueo.

### Corregido durante la verificación

- La validación exigía `:servidor` en los IDs de sala; Matrix v3+ usa IDs opacos. La configuración real fue rechazada en la primera prueba en vivo.

### Pendiente

- Caída de Matrix y de Herdr probadas en vivo (el backoff se probó con funciones simuladas).
- Prueba de punta a punta de la entrada: ver Fase 3.

## 0.7.0 — 2026-10-26

### Añadido

- Fase 3, entrada desde la sala (`src/inbound.mjs`, `src/inbound-events.mjs`): órdenes `estado`, `leer`, `enviar` y `enter`. Solo el dueño, solo en salas cifradas, con alcance por sala (la de control solo lee; la escritura va en la sala del espacio).
- Confirmación para escritura: `confirmar` en 60 s, una acción pendiente por remitente, cancelada por cualquier otro mensaje. El texto de `enviar` no se repite en la sala.
- Tabla de órdenes en código (`src/commands.mjs`); el chat solo elige el verbo.
- Límite de 10 órdenes por remitente y minuto. Mensajes de más de 60 s y propios del bot se ignoran.
- Auditoría en `state/audit.log` (0600): una línea por orden; el texto de `enviar` no se registra (`src/audit.mjs`).
- 28 pruebas nuevas: parser, entrada, auditoría. 82 en total. Docs: `docs/13-fase3-entrada.md`.

### Verificado

- El bridge conecta la entrada al cliente del SDK y la desconecta al parar.
- `pane.read` devuelve `read.text` en el Herdr real (sonda sobre `w4:p1`).
- El bridge arranca con la entrada conectada, sincroniza y se detiene con SIGTERM sin dejar bloqueo.

### Pendiente

- Prueba en vivo de una orden real del dueño. Hace falta una segunda cuenta o que el dueño escriba en Element.
- `leer` envía salida del panel a la sala: revisar con paneles sensibles.
- Pregunta de invitado extra en la sala de control (Fase 2b).

## 0.6.0 — 2026-10-26

### Añadido

- Fase 2b (`src/rooms.mjs`): una sala cifrada y privada por workspace de Herdr. Alta al aparecer el workspace, renombrado al cambiar la etiqueta y archivado al cerrarse (solo lectura, sin borrar). Evento de estado `dev.herdr.workspace` en cada sala. Docs: `docs/12-fase2b-salas.md`.
- `workspace.renamed` en la suscripción a Herdr.
- Comando `verify` (`src/verify.mjs`): verificación del dispositivo del bot desde Element, con el QR dibujado en la consola (`src/qr.mjs`, `qrcode-generator` 2.0.4, dependencia fijada).
- `src/crypto-store.mjs`: el volcado del almacén se cifra con AES-256-GCM; la clave está en `state/crypto/store.key` (0600). Un `store.bin` anterior sin cifrar se acepta una vez.
- 16 pruebas nuevas: salas (`test/rooms.test.mjs`), QR, cifrado del almacén y reconciliación serializada. 54 en total.

### Cambiado

- `routeRoom` devuelve la sala activa del workspace o `null`. Ya no hay sala de control de respaldo: los eventos sin sala se descartan.
- Las reconciliaciones van en serie; `rooms.sync` se ejecuta antes de enrutar.
- Mensaje de error de la contraseña sin terminal: ya no dice "setup" en cualquier comando.

### Verificado contra Herdr 0.9.5 y Synapse

- Arranque con 5 workspaces: 5 salas cifradas creadas, con `dev.herdr.workspace` y nombre.
- Workspace de prueba: alta, renombrado y archivado en vivo (aviso final y `events_default` 100 en el servidor).
- Parada con SIGTERM: sale y libera `bridge.lock`.
- `verify` sin terminal: falla antes de pedir la contraseña y libera el bloqueo.

### Pendiente

- Escaneo del QR desde Element por el dueño (no hecho; requiere su cliente y su contraseña en terminal).
- Pregunta de invitado extra en la sala de control (requiere sincronización de la Fase 3).
- Estabilidad de `workspace_id` entre reinicios de Herdr.
- Clave del almacén junto a `store.bin`: mejora pendiente (keyring o contraseña).

## 0.5.0 — 2026-10-25

### Añadido

- Envío cifrado con `matrix-js-sdk` 43.0.0 y crypto Rust (`@matrix-org/matrix-sdk-crypto-wasm` 18.9.0). Dependencias fijadas y `package-lock.json` commiteado. Excepción justificada de la decisión 12 del plan.
- `src/bot-client.mjs`: cliente del bot con dispositivo de `session.json`. Al parar, guarda el almacén y no cierra sesión.
- `src/crypto-store.mjs`: persistencia del almacén de IndexedDB en `state/crypto/store.bin` (0600). Se vuelca al parar y cada 60 s, y se restaura al arrancar.
- `docs/11-e2ee-salida.md`: dependencias, persistencia, verificación y límites.
- 38 pruebas (`npm test`).

### Cambiado

- `src/sender.mjs`: envía con el SDK solo si la sala tiene cifrado activo. Sustituye al remitente que rechazaba todo envío.
- `setup` y `setup --logout` borran el almacén criptográfico (cada login es un dispositivo nuevo).
- `src/index.mjs`: sale explícitamente al terminar; ignora solo `ClientStoppedError` tras parar el cliente.
- `.gitignore`: excluye `node_modules/`.

### Verificado contra Synapse

- Setup con dispositivo nuevo.
- Mensaje de prueba cifrado a la sala de control: el servidor guarda `m.room.encrypted` sin texto en claro.
- Dos ejecuciones con el mismo dispositivo: mismas claves Ed25519 y Curve25519.
- `run` arranca, registra la línea base y se detiene con SIGINT liberando el bloqueo.

### Pendiente

- Verificación del dispositivo del bot por el dueño (Element mostrará aviso de no verificado).
- Almacén criptográfico en claro en disco (0600). Mejora: `storagePassword`.
- Transición real de estado de agente de punta a punta.
- Fase 2b (salas por proyecto).

## 0.4.0 — 2026-10-25

### Añadido

- Salida Herdr → Matrix (`node src/index.mjs run`): bridge con línea base, detección de transiciones por reconciliación con `agent.list`, formato `[workspace/tab/panel] estado: texto`, límite de 1 mensaje por panel cada 10 s, bloqueo de instancia única y parada limpia con SIGINT.
- `src/herdr.mjs`: cliente del socket. Una conexión por petición; una persistente para eventos. Valida que el socket sea del usuario actual.
- `src/sender.mjs`: nunca envía en claro a una sala cifrada.
- `docs/10-fase2-salida.md`: diseño, decisiones y límites de la fase.
- 36 pruebas (`npm test`).

### Cambiado

- `pane.agent_status_changed` no se usa: exige `pane_id` en la suscripción (verificado).
- Notificación de panel cerrado con el texto "panel cerrado" (no "con error"): `pane_exited` no trae código de salida.

### Verificado contra Herdr 0.9.5

- Herdr cierra el socket tras cada petición normal; solo la suscripción permanece abierta.
- Suscripción confirmada con los 7 tipos usados; línea base de 4 paneles; parada con SIGINT.

### Pendiente

- Envío real a salas cifradas: bloqueado por E2EE de salida (dispositivo y capa de cifrado; ver `plans/06-plan.md`, Fase 0 punto 5). El criterio de salida de la Fase 2 no se cumple todavía.
- Transición real de estado y formato de eventos reales: no observados.
- Fase 2b (salas por proyecto).

## 0.3.0 — 2026-10-25

### Añadido

- Plugin base de Herdr: `herdr-plugin.toml` con la acción `setup`. Registrado con `herdr plugin link`.
- `src/`: `setup` (URL, usuario, contraseña sin eco, MXID del dueño, sala de control cifrada, `config.json` con `config_version`) y `setup --logout` (revoca el token y borra la sesión local).
- Cliente Matrix sin dependencias: sin redirecciones, timeout y tope de 1 MB por respuesta.
- `test/`: 14 pruebas con `npm test`.
- `docs/09-herdr-esquema.md`: esquema de Herdr 0.9.5 verificado. Corrige `workspace_id`, la ausencia de código de salida en `pane_exited` y los nombres de eventos.

### Verificado contra el servidor

- `setup` crea sala de control cifrada y confirma `m.room.encryption`. Una segunda ejecución reutiliza la sala.
- `setup --logout` revoca la sesión.

### Pendiente

- Dispositivo E2EE del bot y verificación desde el cliente del dueño (paso 6 de Fase 1; ver `plans/06-plan.md`, Fase 0, punto 5).
- Invitación al dueño: enviada, sin confirmar la entrada a la sala.
- Acción `setup` de Herdr sin terminal interactiva.

## 0.2.0 — 2026-10-25

### Añadido

- `docs/07-e2ee-bibliotecas.md`: evaluación de bibliotecas E2EE. Recomendación: matrix-js-sdk con crypto Rust (vodozemac). libolm está deprecada.
- `docs/08-salas-por-proyecto.md`: análisis de una sala cifrada por workspace de Herdr.
- `plans/06-plan.md` v4 con decisiones 14–19: salas por proyecto, sala de control, invitado por defecto (usuario enlazado), creación automática con pregunta en la sala de control, archivado de proyectos cerrados, y alcance por sala (la sala de control solo lee paneles de otros espacios).

### Cambiado

- E2EE obligatorio en todas las salas (requisito del usuario). Decisiones 3, 10 y 12 del plan actualizadas.
- Riesgo de lectura por el administrador del servidor: contenido protegido por E2EE; metadatos siguen visibles.

### Verificado contra el servidor

- `invite` a un usuario inexistente responde 200. La validación debe hacerse con `GET /profile/{mxid}` (responde 404 si no existe).
- Invitación a `@owner` aceptada; mensajes de prueba recibidos.
- `bot-test` no es administrador (Admin API responde `M_FORBIDDEN`).

### Pendiente

- Salas de prueba creadas sin cifrado. Crear salas nuevas cifradas cuando haya cliente E2EE.
- Spike de E2EE con matrix-js-sdk (Fase 0).

## 0.1.0 — 2026-10-25

### Añadido

- `docs/`: análisis de plugins de Herdr, socket API, Matrix/Synapse, diseño propuesto, preguntas abiertas y verificación de Synapse.
- `plans/06-plan.md`: plan de implementación v4 (revisado como senior developer y architect, y securizado).
- `planes/`: modelado de amenazas y revisión de seguridad del plugin (clasificación crítica).
- `informes/`: informe de análisis de seguridad de la fase 0 y del diseño.
- `.gitignore`: excluye `.env` y `.env.*` (credenciales locales).

### Verificado contra el servidor (cuenta de prueba)

- Versiones de Client-Server API, login, `whoami`, `createRoom`, envío de mensaje, `sync` con filtro y `logout`: OK.
- Admin API sin token: 401 (accesible en el puerto público, requiere autenticación).

### Pendiente

- Segunda cuenta de prueba para `invite`.
- Esquema de Herdr (`herdr api schema`).
- Revisión de `agent-telegram-notify`.
