# Plugins de Herdr

Fuente: https://herdr.dev/docs/plugins/ · Versión de docs de socket consultada: 0.9.5.

## Modelo general

- Un plugin es un **directorio** con un archivo `herdr-plugin.toml` (manifest) y los comandos que Herdr puede lanzar.
- Los comandos pueden estar en cualquier lenguaje (bash, Node, Python, binario compilado).
- Los comandos son **arrays de argv**. Herdr no usa shell; si se necesita expansión, hay que invocar un shell explícitamente.
- No hay SDK. **La CLI de Herdr es la API del plugin**; también existe la API por socket (ver `02-herdr-socket-api.md`).
- No hay sandbox ni modelo de permisos. El plugin corre como el usuario, hereda el entorno y puede llamar a toda la CLI. [confirmado]

## Manifest (`herdr-plugin.toml`)

Campos obligatorios de nivel superior: `id`, `name`, `version`, `min_herdr_version`. Opcionales: `description`, `platforms` (`linux`, `macos`, `windows`). [confirmado]

Reglas de ids:

- **Plugin id**: letras ASCII, dígitos, punto, dos puntos, guion bajo y guion.
- **Ids locales** (acciones, paneles, link handlers): letras, dígitos, dos puntos, guion bajo y guion, **sin punto**. Deben ser únicos dentro del plugin. Herdr los califica como `plugin.id.accion`. [confirmado]

Ejemplo mínimo (de la documentación):

```toml
id = "example.workspace-tools"
name = "Workspace Tools"
version = "0.1.0"
min_herdr_version = "0.7.0"
description = "Small workspace helpers"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "list-workspaces"
title = "List workspaces"
contexts = ["workspace"]
command = ["node", "index.js"]
```

Ejemplo completo con todos los entrypoints:

```toml
id = "example.layout"
name = "Layout"
version = "0.1.0"
min_herdr_version = "0.7.0"
description = "Apply project layouts"
platforms = ["linux", "macos", "windows"]

[[build]]
command = ["npm", "ci"]

[[build]]
command = ["npm", "run", "build"]
platforms = ["linux", "macos"]

[[startup]]
command = ["node", "dist/restore.js"]

[[actions]]
id = "apply"
title = "Apply layout"
contexts = ["workspace"]
command = ["node", "dist/apply.js"]

[[events]]
on = "worktree.created"
command = ["herdr", "workspace", "list"]

[[panes]]
id = "board"
title = "Project board"
placement = "overlay"
command = ["herdr-board"]

[[link_handlers]]
id = "github-issue"
title = "Open GitHub issue"
pattern = "^https://github\\.com/[^/]+/[^/]+/(issues|pull)/[0-9]+$"
action = "apply"
```

## Entrypoints

| Bloque | Cuándo corre | Notas |
|---|---|---|
| `[[build]]` | Al instalar desde GitHub, tras confirmación y antes de registrar. | Si falla, aborta la instalación. `plugin link` lo omite. |
| `[[startup]]` | Una vez por plugin habilitado, tras restaurar la sesión y con el socket listo. | **Inicializadores de un solo disparo, no daemons.** Si falla, el servidor sigue. [confirmado] |
| `[[actions]]` | Al invocarla (`action invoke`, tecla, menú). | Tiene `id`, `title`, `contexts`, `command`. |
| `[[events]]` | Al ocurrir un evento con nombre (`on`). | Recibe `HERDR_PLUGIN_EVENT_JSON`. El ejemplo usa `worktree.created`. |
| `[[panes]]` | Al abrir el panel (`pane open`). | `placement`: `overlay` (default), `popup`, `split`, `tab`, `zoomed`. `popup` admite `width` y `height`. |
| `[[link_handlers]]` | Control-click en una URL que coincide con `pattern` (regex Rust). | Solo con `ui.mouse_capture` activo. |

> **Implicación clave para este proyecto:** un `[[startup]]` no sirve como proceso de larga duración (el listener de Matrix). Opciones: (a) un `[[panes]]` que corra el bridge en un panel visible; (b) un `[[keys.command]]` con `type = "shell"` (documentado como "detached background", sin ejemplo); (c) que el startup lance un proceso desacoplado (`setsid`/`nohup`) — funciona pero no lo documenta Herdr y hay que gestionar su ciclo de vida. Ver preguntas en `05-preguntas.md`.

## Teclas

```toml
[[keys.command]]
key = "prefix+l"
type = "plugin_action"
command = "example.layout.apply"
description = "apply layout"
```

Otros tipos de `keys.command`: `popup` (con `width`/`height`), `pane` (panel temporal con zoom), `shell` (background desacoplado). [confirmado]

## Variables de entorno inyectadas

- Siempre: `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_ENV`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`, `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_CONTEXT_JSON`.
- Si están disponibles: `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`.
- Por tipo: `HERDR_PLUGIN_ACTION_ID`; `HERDR_PLUGIN_EVENT` y `HERDR_PLUGIN_EVENT_JSON`; `HERDR_PLUGIN_ENTRYPOINT_ID`; `HERDR_PLUGIN_CLICKED_URL` y `HERDR_PLUGIN_LINK_HANDLER_ID`. [confirmado]

El directorio de trabajo es `HERDR_PLUGIN_ROOT`.

**Dónde guardar credenciales:** no en `HERDR_PLUGIN_ROOT` (en instalaciones desde GitHub es un checkout gestionado). Usar:

- `HERDR_PLUGIN_CONFIG_DIR`: configuración editable por el usuario (URL del servidor, usuario bot, sala).
- `HERDR_PLUGIN_STATE_DIR`: estado de ejecución (access token, `next_batch` de sync, logs).

[confirmado]. Recomendación: guardar el access token con permisos `0600`, no la contraseña.

## Ciclo de vida

- `herdr plugin install owner/repo[/subdir]`: clona con git, muestra preview, corre `build` y registra. Flags: `--yes` (no interactivo), `--ref` (fijar revisión).
- `herdr plugin link /ruta`: desarrollo local, **no corre build**.
- `herdr plugin update`: actualiza plugins de GitHub. Los procesos en curso mantienen sus archivos originales.
- `herdr plugin uninstall`: desregistra y conserva archivos hasta que sea seguro borrarlos. `unlink` solo desregistra.
- Comandos útiles: `plugin list`, `plugin config-dir <id>`, `plugin action list --plugin <id>`, `plugin action invoke <id>`, `plugin pane open --plugin <id> --entrypoint <id>`, `plugin log list --plugin <id>`. [confirmado]
- Los plugins son **globales al usuario**, no por sesión.

## Notificaciones

Herdr no tiene un mecanismo de "notificar a un destino externo" en los plugins. Las notificaciones que existen son:

- **Dentro de Herdr** (toast): `notification.show` (ver `02-herdr-socket-api.md`).
- **Eventos** para reaccionar: los `[[events]]` del manifest, o suscripciones por socket (`events.subscribe`).

Para enviar a Matrix, **el plugin tiene que llamar a Matrix por su cuenta** (HTTP). Herdr no lo hace por él. [confirmado: no hay hook de notificación externa en la doc]

## Ejemplos y marketplace

- Cookbook no oficial: `ogulcancelik/herdr-plugin-examples`. Incluye `agent-telegram-notify`, que es el ejemplo más cercano a este proyecto (notificaciones a un servicio de mensajería). **Vale la pena leerlo antes de diseñar**; no se pudo consultar en este análisis.
- Marketplace: repos públicos de GitHub con el topic `herdr-plugin`, indexados cada 30 minutos.

Ejemplo de script Node que llama a Herdr (de la doc):

```javascript
const { spawnSync } = require("node:child_process");
const herdr = process.env.HERDR_BIN_PATH ?? "herdr";

const result = spawnSync(herdr, ["workspace", "list"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
```

## Limitaciones de la v1 (según la doc)

- Sin storage API: el plugin maneja sus propios archivos o base de datos.
- Sin UI nativa no terminal.
- Sin registro de acciones en tiempo de ejecución.
- Sin revisión de código ni sandbox: el manifest se valida, el código no.
