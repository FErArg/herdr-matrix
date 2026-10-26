# Herdr Matrix

Plugin de Herdr que publica novedades de los agentes en salas Matrix cifradas y recibe órdenes desde el chat del dueño.

Estado: versión 0.16.0. Ver `CHANGELOG.md` para lo verificado y lo pendiente, y `docs/` para el diseño de cada fase.

Licencia: GNU GPL v3 (ver `LICENSE`).

## Requisitos

- Herdr 0.9.5 o superior, en Linux o macOS.
- Node.js 22 o superior.
- Un servidor Matrix (Synapse) con HTTPS. Un usuario para el bot y otro para el dueño.

## Instalación

```
npm ci --ignore-scripts
herdr plugin link /ruta/a/hm-plugin-base
```

`npm ci` instala las versiones fijadas de `package-lock.json`. `--ignore-scripts` evita scripts de terceros.

Alternativa con script (macOS y Linux). Comprueba Node, Herdr e instala dependencias y enlaza el plugin:

```
scripts/install.sh            # instala y enlaza
scripts/install.sh --setup    # además lanza la configuración interactiva
```

Para desinstalar. Revoca la sesión en el servidor, desenlaza el plugin y conserva la configuración:

```
scripts/uninstall.sh          # conserva config.json
scripts/uninstall.sh --purge  # además borra configuración y estado
```

El bridge no se arranca desde los scripts. Si está en ejecución, `uninstall.sh` se niega a continuar.

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

**Antes de usar el chat, el proyecto debe estar iniciado.** El chat solo responde a través del agente de su propio workspace (Claude Code u opencode). Si el workspace no tiene un agente abierto en su panel, el chat no se abre o no responde. Abre el agente en el workspace antes de escribir en su sala.

Reglas del chat:

- Un workspace tiene un agente. Si hay más de uno, el chat no se abre.
- Los mensajes de una sala solo llegan al agente de su workspace. Ningún agente de otro workspace responde en esa sala.
- opencode se ejecuta en el directorio del workspace, no en el del bridge.

## Órdenes

Se envían desde una sala. Solo el dueño puede enviarlas.

| Orden | Dónde | Qué hace |
|---|---|---|
| `estado` | Sala de control o de un espacio | Lista los agentes del alcance |
| `leer <panel>` | Sala de control o del espacio del panel | Últimas 20 líneas del panel |
| `enviar <panel> <texto>` | Solo sala del espacio del panel | Escribe texto en el panel, tras confirmar |
| `enter <panel>` | Solo sala del espacio del panel | Pulsa Enter en el panel, tras confirmar |
| `confirmar` | Misma sala que la orden | Ejecuta la orden pendiente (60 s) |

Los paneles tienen el formato `w1:p1`. Un mensaje de otro tipo, o un verbo que no está en la lista, no ejecuta nada. Cualquier mensaje distinto de `confirmar` cancela una orden pendiente.

## Archivos

Directorio de configuración (`HERDR_PLUGIN_CONFIG_DIR` o `~/.config/herdr-matrix`):

- `config.json`: URL, dueño, sala de control, salas por workspace. Sin secretos.

Directorio de estado (`HERDR_PLUGIN_STATE_DIR` o `~/.local/state/herdr-matrix`), todo con permisos 0600:

- `session.json`: token de acceso y dispositivo del bot.
- `crypto/store.bin` y `crypto/store.key`: almacén criptográfico, cifrado con la clave del lado.
- `herdr-snapshot.json`: último estado de los agentes.
- `audit.log`: una línea por orden. El texto de `enviar` no se registra.
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
