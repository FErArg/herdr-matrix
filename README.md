# Herdr Matrix

Plugin de Herdr que publica novedades de los agentes en salas Matrix cifradas y recibe órdenes desde el chat del dueño.

Estado: versión 0.18.1. Ver `CHANGELOG.md` para lo verificado y lo pendiente, y `docs/` para el diseño de cada fase.

Licencia: GNU GPL v3 (ver `LICENSE`).

## Requisitos

- Herdr 0.9.5 o superior, en Linux o macOS.
- Node.js 22 o superior.
- Un servidor Matrix (Synapse) con HTTPS. Un usuario para el bot y otro para el dueño.

## Instalación

```
npm ci --ignore-scripts
herdr plugin link /ruta/a/herdr-matrix
```

`npm ci` instala las versiones fijadas de `package-lock.json`. `--ignore-scripts` evita scripts de terceros.

Alternativa con script (macOS y Linux). Comprueba Node y Herdr, instala dependencias y enlaza el plugin. Reenlaza siempre, para que Herdr registre el manifiesto actual:

```
scripts/install.sh            # instala y enlaza
scripts/install.sh --setup    # además lanza la configuración interactiva
```

Para desinstalar. Revoca la sesión en el servidor, desenlaza el plugin y conserva la configuración:

```
scripts/uninstall.sh          # conserva config.json
scripts/uninstall.sh --purge  # además borra configuración y estado
```

El bridge no se arranca desde los scripts. Si está en ejecución, `uninstall.sh` se niega a continuar. Avisa si quedan directorios de una versión anterior (`~/.config/herdr-matrix`, `~/.local/state/herdr-matrix`); puedes borrarlos a mano.

## Configuración

`setup` se ejecuta desde una terminal dentro del directorio del plugin. La acción `setup` de Herdr no tiene terminal interactiva.

```
node src/index.mjs setup
```

Pide la URL del servidor, el usuario y la contraseña del bot (sin eco), y el MXID del dueño. Crea la sala de control cifrada e invita al dueño. El dispositivo del bot es nuevo en cada `setup`.

Después, verifica el dispositivo del bot desde el cliente del dueño:

```
node src/index.mjs verify
```

El QR aparece en la consola. El dueño lo escanea desde Element (Verificar por escaneo). Con `verify` no debe correr el bridge.

## Uso

```
node src/index.mjs run
```

Corre el bridge hasta SIGINT o SIGTERM. Si se cierra la suscripción de Herdr o hay un fallo transitorio, reintenta con espera creciente (1 s, 2 s, 4 s… hasta 60 s). Después de 5 fallos seguidos sale con error. Una configuración inválida sale sin reintentar.

Al arrancar Herdr, el `[[startup]]` del manifiesto ejecuta `node src/index.mjs startup`. Ese comando lanza el bridge en segundo plano y termina. Su salida va a `state/bridge.log`. Sin configuración, o con el bridge ya en ejecución, no hace nada.

Cada workspace de Herdr tiene su sala cifrada. Se crea al aparecer, se renombra al cambiar de nombre y se archiva (solo lectura) al cerrarse.

**Antes de usar el chat, el proyecto debe estar iniciado.** El chat responde a través del agente de su propio workspace (Claude Code u opencode). Abre el agente en el panel del workspace antes de escribir en su sala. Con opencode, sin agente abierto el chat no se abre. Con Claude Code, ver la sección siguiente.

Reglas del chat:

- Un workspace tiene un agente. Si hay más de uno, el chat no se abre.
- Los mensajes de una sala solo llegan al agente de su workspace. Ningún agente de otro workspace responde en esa sala.
- opencode se ejecuta en el directorio del workspace, no en el del bridge.

### Chat con Claude Code

Escribe `chat claude` en la sala del workspace y confirma con `confirmar`. El bridge:

1. Busca el agente del workspace. Si hay uno, usa su panel. Si no hay ninguno, arranca Claude Code en el panel principal del workspace (`w1:p1`) y espera hasta 90 s a que esté listo.
2. Pide al agente que responda en texto plano y breve, apto para el chat.
3. Cada mensaje de la sala se escribe en el panel con `agent.prompt` y el bridge espera a que el agente vuelva a estar inactivo (hasta 15 min). La respuesta se lee de la transcripción de Claude Code y se publica en la sala, en trozos de 3500 caracteres como máximo.

Mientras el agente trabaja, los mensajes siguen su orden. Escribe `salir` para cerrar la sesión.

### Chat con opencode

Escribe `chat opencode` en la sala del workspace y confirma con `confirmar`. El bridge:

1. Busca el agente del workspace. Debe ser opencode y tener un directorio de proyecto. Si no lo encuentra, no abre la sesión.
2. Cada mensaje de la sala ejecuta `opencode run` en el directorio del proyecto del workspace, con `--auto` (aprueba los permisos sin preguntar) y en la misma sesión de opencode que el mensaje anterior. La primera vez crea la sesión.
3. La respuesta se lee de la base de datos de opencode (`~/.local/share/opencode/opencode.db`) y se publica en la sala. Si `opencode run` no termina en 3 min, el bridge avisa en la sala.

Con opencode, el panel del TUI y el chat no se coordinan: si el TUI está ocupado con otra tarea, el mensaje espera o falla por tiempo. Un workspace con dos agentes no abre el chat.

### Reinicio del bridge

Si el bridge se reinicia con una sesión de chat abierta, la sesión se conserva en `chats.json`. Los mensajes que quedaron sin enviar no salen solos: el bridge avisa en la sala y espera `confirmar` (enviarlos) o `descartar` (borrarlos).

## Órdenes

Se envían desde una sala. Solo el dueño puede enviarlas.

| Orden | Dónde | Qué hace |
|---|---|---|
| `estado` | Sala de control o de un espacio | Lista los agentes del alcance |
| `leer <panel>` | Sala de control o del espacio del panel | Últimas 20 líneas del panel |
| `enviar <panel> <texto>` | Solo sala del espacio del panel | Escribe texto en el panel, tras confirmar |
| `enter <panel>` | Solo sala del espacio del panel | Pulsa Enter en el panel, tras confirmar |
| `chat <claude\|opencode>` | Solo sala de un workspace | Abre una sesión de chat con el agente del workspace, tras confirmar |
| `salir` | Sala con sesión de chat abierta | Cierra la sesión de chat |
| `confirmar` | Misma sala que la orden | Ejecuta la orden pendiente (60 s) |
| `descartar` | Sala con mensajes de chat pendientes | Borra los mensajes en cola tras reiniciar el bridge |

Los paneles tienen el formato `w1:p1`. Un mensaje de otro tipo, o un verbo que no está en la lista, no ejecuta nada. Cualquier mensaje distinto de `confirmar` cancela una orden pendiente.

Con una sesión de chat abierta, todo lo que escribes en esa sala va al agente, salvo `salir`. Si el bridge se reinicia con mensajes en cola, no los envía hasta que respondas `confirmar` (enviarlos) o `descartar` (borrarlos).

## Archivos

Herdr arranca el plugin con sus propios directorios, y `setup`, `verify` y `run` usan los mismos. Por eso `install.sh` y `uninstall.sh` los exportan antes de actuar. Si ejecutas `node src/index.mjs` a mano, exporta `HERDR_PLUGIN_CONFIG_DIR` y `HERDR_PLUGIN_STATE_DIR` con esos mismos valores (los muestra `install.sh`). Si no están definidos, se usan `~/.config/herdr-matrix` y `~/.local/state/herdr-matrix`.

Directorio de configuración (`HERDR_PLUGIN_CONFIG_DIR`, normalmente `~/.config/herdr/plugins/config/herdr-matrix`):

- `config.json`: URL, dueño, sala de control, salas por workspace. Sin secretos.

Directorio de estado (`HERDR_PLUGIN_STATE_DIR`, normalmente `~/.local/state/herdr/plugins/herdr-matrix`), todo con permisos 0600:

- `session.json`: token de acceso y dispositivo del bot.
- `crypto/store.bin` y `crypto/store.key`: almacén criptográfico, cifrado con la clave del lado.
- `herdr-snapshot.json`: último estado de los agentes.
- `chats.json`: sesiones de chat abiertas, por sala.
- `audit.log`: una línea por orden. El texto de `enviar` no se registra.
- `bridge.log`: salida del bridge cuando lo arrancó Herdr.
- `bridge.lock`: bloqueo de instancia única.

## Riesgos conocidos

- **Clave junto al almacén.** `store.key` está en el mismo directorio que `store.bin`. Quien lea ese directorio puede descifrarlo.
- **`leer` muestra salida de paneles en la sala.** Si un panel muestra un secreto, aparece en Matrix. Usa `leer` solo en paneles que puedan mostrarse.
- **Metadatos en el servidor.** El servidor no lee el contenido cifrado, pero ve quién escribe, cuándo y en qué sala.
- **Sin prueba en vivo de una orden remota completa.** Ver `docs/13-fase3-entrada.md`.

## Rotación

- **Contraseña del bot:** cámbiala en el servidor, luego ejecuta `node src/index.mjs setup --logout` y `setup` de nuevo. Esto crea un dispositivo nuevo.
- **Sesión:** `node src/index.mjs setup --logout` revoca el token y borra `session.json` y el almacén criptográfico. La configuración se conserva.
- **Dispositivo comprometido:** `setup --logout` y después `setup`. El dispositivo anterior queda revocado en el servidor.

## Pruebas

```
npm test
```

Las pruebas usan servidores y clientes simulados. No necesitan Herdr ni Synapse.
