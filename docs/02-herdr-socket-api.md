# Herdr — API por socket y CLI

Fuente: https://herdr.dev/docs/socket-api/ · https://herdr.dev/docs/configuration/

## Conexión

- Unix: socket de dominio Unix. Windows: named pipe.
- Protocolo: **JSON delimitado por saltos de línea** (un request por línea) con `id`, `method`, `params`.
- Respuesta OK: echo de `id` + `result` con campo `type`. Error: echo de `id` + `error` con `code` y `message`.
- Las suscripciones a eventos mantienen la conexión abierta tras la primera respuesta.
- Socket por defecto: `~/.config/herdr/herdr.sock`. Sesión con nombre: `~/.config/herdr/sessions/<nombre>/herdr.sock`.
- Orden de resolución: flag `--session` de la CLI → `HERDR_SOCKET_PATH` → `HERDR_SESSION` → socket por defecto. [confirmado]
- Introspección: `herdr api schema [--json] [--output PATH]`, `herdr api snapshot`. [confirmado]

## Métodos relevantes para el plugin

### Notificaciones (salida hacia el usuario local)

- Método `notification.show`. Obligatorio: `title`. Opcionales: `body`, `position`, `sound`.
- Límites: título 80 caracteres, cuerpo 240; saltos de línea se colapsan.
- `sound`: `none`, `done`, `request`. `position` solo aplica con `ui.toast.delivery = "herdr"`.
- Respuesta: `shown` + `reason` (`shown`, `disabled`, `rate_limited`, `no_foreground_client`, `busy`).
- CLI: `herdr notification show "build failed" --body "api workspace" --position top-left --sound request` [confirmado]

### Eventos (entrada: lo que hace Herdr)

- `events.subscribe` con lista `subscriptions`; cada entrada tiene `type` y filtros opcionales (`pane_id`, `agent_status`). La primera respuesta confirma.
- Eventos útiles para "novedades":
  - `pane.agent_status_changed` — cambio de estado de agente.
  - `pane.agent_detected` — se detectó un agente en un panel.
  - `pane.exited` — un panel terminó.
  - `pane.output_matched` — coincidencia de patrón en la salida (ideal para "pide confirmación").
  - `workspace.*`, `tab.*`, `worktree.*` — cambios de estructura.
- Estados efectivos de agente: `idle`, `working`, `blocked`, `done`, `unknown`.
- Si un panel referenciado no existe, **falla toda la petición** y se cierra la conexión.
- Si el suscriptor se atrasa: error `events_lost`. Recuperación: resuscribir, llamar a `session.snapshot` y reconciliar. **Los eventos son señales para re-leer estado, no datos para reproducir.** [confirmado]
- `events.wait`: espera un evento puntual.

### Agentes (órdenes desde el chat)

- `agent.list`, `agent.get`, `agent.read` — listar y leer salida.
- `agent.prompt` — enviar un prompt a un agente; admite `wait: { until, timeout_ms }` para esperar. Si ya está `blocked`, responde `agent_blocked`.
- `agent.wait` — espera a un estado (`done` o `blocked`). CLI: `herdr agent wait w1:p1 --until done`.
- `agent.send_keys`, `agent.start`, `agent.focus`, `agent.rename`.

### Paneles (acciones de bajo nivel)

- `pane.list`, `pane.get`, `pane.current`, `pane.read` (fuentes: `visible`, `recent`, `recent-unwrapped`, `detection`).
- `pane.send_text`, `pane.send_keys`, `pane.send_input` — entrada. Aceptan combos como `enter`, `esc`, `ctrl+h`; **no** aceptan `prefix+`.
- `pane.split`, `pane.close`, `pane.zoom`, `pane.resize`, `pane.swap`, `pane.move`.
- IDs de panel: `w1:p1`. Si `pane_id` es opcional, se usa el panel enfocado.
- CLI: `herdr pane run w1:p2 "npm test"`, `herdr pane read w1:p2 --source recent --lines 50`. [confirmado]

### Workspaces, tabs, worktrees

- `workspace.create|list|get|focus|rename|close`, `tab.*`, `worktree.list|create|open|remove` (`worktree.remove` no borra la rama).

### Plugins (desde el socket)

- `plugin.list|link|unlink|enable|disable|action.list|action.invoke|log.list|pane.open|pane.focus|pane.close`.

### Metadata y ventana

- `pane.report_metadata`, `workspace.report_metadata`: cambian presentación (título, etiquetas, tokens) sin alterar el estado de ciclo de vida.
- `client.window_title.set|clear`.

## Notas de estabilidad

- Cliente y servidor no necesitan la misma build: negocian codecs y métodos al conectar.
- Métodos no soportados devuelven error normal. Los clientes JSON deben ignorar campos desconocidos.

## Configuración relevante (`config.toml` de Herdr)

Notificaciones:

```toml
[ui.toast]
delivery = "herdr"        # herdr | terminal | system | off
delay_seconds = 1

[ui.toast.herdr]
position = "bottom-right"
```

- `terminal`: notificación del terminal externo, funciona por SSH.
- `system`: notificación del SO. En macOS usa `terminal-notifier` o `osascript`; en Windows queda en Notification Center.
- Herdr no muestra popups para la pestaña activa.

Sonidos (mp3, rutas relativas al archivo de configuración):

```toml
[ui.sound]
path = "sounds/notification.mp3"
done_path = "sounds/done.mp3"
request_path = "sounds/request.mp3"

[ui.sound.agents]
claude = "on"
```

Estado de agentes: `[ui] status_indicators = "symbols"`.

Teclas para comandos de plugin:

```toml
[[keys.command]]
key = "prefix+l"
type = "plugin_action"
command = "example.layout.apply"
description = "apply layout"
```

Los comandos lanzados desde teclas reciben `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID`, `HERDR_ACTIVE_PANE_CWD`.

## Lo que la doc NO cubre (pendiente)

- Lista completa de parámetros y formatos de respuesta de cada método. La referencia completa está en la página de socket API; aquí solo hay resumen.
- Formato exacto de los mensajes de evento (campos del JSON). Hay que obtenerlo con `herdr api schema --json` o con una suscripción de prueba.
- Si `events.subscribe` requiere `session` o autenticación adicional. Hay que probarlo.

**Acción recomendada antes de implementar:** correr `herdr api schema --json --output docs/herdr-schema.json` y guardarlo en `docs/`. Es la fuente exacta de parámetros.
