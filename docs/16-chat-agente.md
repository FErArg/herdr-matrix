# Chat directo con el agente de un espacio

Estado: **implementado en 0.11.0 y verificado en vivo** (2026-10-26) en `hm-prueba-inv2`, con un agente de prueba.

## Qué se pide

Desde la sala de un espacio, el dueño escribe mensajes en lenguaje natural y el agente de IA del espacio responde. Si no hay agente abierto, el bot arranca uno (`claude` u `opencode`). El agente interpreta; el bot solo transporta.

## Primitivas de Herdr verificadas en el esquema

| Necesidad | Método | Dato verificado |
|---|---|---|
| Arrancar agente | `agent.start` (`name`, `kind`, `pane_id`, `args`) | `kind` acepta `claude` y `opencode`, entre otros tipos de integración. |
| Enviar mensaje | `agent.prompt` (`target`, `text`, `wait`) | `wait` puede esperar a estados (`until`) con `timeout_ms`. |
| Respuesta | `agent.read` antes y después, y se envía lo nuevo | `agent_prompted` devuelve solo el agente, **no el texto de la respuesta**. |

## Flujo propuesto

1. Abrir sesión de chat: el bot pregunta en la sala del espacio y confirmar con `confirmar`. La sesión caduca tras un tiempo sin mensajes (propuesta: 30 min).
2. Si no hay agente en el panel del espacio, `agent.start` con el tipo elegido.
3. Cada mensaje del dueño: `agent.prompt` con `wait` hasta que el agente quede inactivo, con tiempo límite.
4. Respuesta: `agent.read` antes y después; se envía lo nuevo, sin la interfaz del terminal, y limitado en tamaño.
5. Cierre de sesión: `salir` o caducidad. El agente sigue abierto; no se cierra.

## Decisiones tomadas

1. **Sin caducidad.** La sesión queda abierta hasta que el dueño escriba `salir`. Como la sesión puede durar días, se muestra un aviso al abrirla y se conserva al reiniciar el bridge (estado en `state/`).
2. **Formato de respuesta.** El bot pide al agente respuestas breves y en texto plano, aptas para un mensaje de chat. La instrucción se envía una vez al abrir la sesión y se indica en la sala.
3. **Datos.** La respuesta se muestra con un límite de tamaño; el resto queda en el panel. *(Pendiente de confirmar por el dueño.)*
4. **Mensajes seguidos.** Se encolan en orden y no se pierden. La cola se guarda en `state/`.

## Tensión con las reglas existentes

El plan descarta las órdenes con más de 60 s de antigüedad, para que una orden antigua no se ejecute al reiniciar. Con la cola persistente, ese descarte haría perder mensajes. Propuesta: al reiniciar, el bot no envía los mensajes en cola; avisa en la sala ("tienes N mensajes de hace X min, ¿los envío?") y espera confirmación.

## Verificado en vivo (2026-10-26)

Workspace de prueba `hm-chat-test` (`w9`), cerrado al terminar.

- `agent.start` con `kind: claude` arranca el agente en el panel. Devuelve `agent_started` con `launch_pending: true`.
- `agent.prompt` con `wait: {until: [idle, done]}` devuelve `agent_prompted` con el estado `done` del agente. **No devuelve el texto de la respuesta.**
- `agent.read` con `source: recent` devuelve la pantalla del panel: cabecera de Claude Code, el prompt enviado (`❯ …`), la respuesta (`● prueba`) y la línea de estado (`✻ … done`). La respuesta está ahí; hay que extraerla.
- Con `lines: 200` la lectura ocupó solo 600 caracteres: el panel es pequeño. Una respuesta larga puede salir cortada. **Pendiente:** comprobar con una respuesta larga y `source` distinto (`recent_unwrapped`).

Consecuencia: la extracción es `agent.read` + recorte entre la línea del prompt y la línea de estado, sin la cabecera. Es frágil si cambia la interfaz de Claude Code; por eso conviene verificarla en cada versión del agente.

## Verificación pendiente

- Respuesta larga: que `agent.read` la conserva completa, y con qué `source`.
- Arranque de `opencode` con `agent.start`.

## Implementación (0.11.0)

- `src/transcript.mjs`: la respuesta completa se lee de la transcripción de Claude Code (`~/.claude/projects/<cwd>/<sesión>.jsonl`), no del panel. El panel solo muestra lo visible: en la prueba, la lista de 60 números perdió el `1` inicial.
- `src/chat.mjs`: sesión por espacio con cola persistida (`state/chats.json`), un worker en serie, envío de la respuesta en trozos de hasta 3500 caracteres, y pausa tras reiniciar hasta confirmar.
- `src/inbound.mjs`: `chat` abre la sesión con confirmación; `salir` la cierra; con sesión abierta, cada mensaje va a la cola y el bot responde `recibido; en cola: N`.
- El chat usa el panel raíz del espacio (`wN:p1`). Si el agente no existe, se arranca `claude` y se espera a que acepte entrada antes de enviar nada.

## Verificado en vivo

- Abrir sesión con `chat` + `confirmar`; respuestas recibidas en orden.
- `salir` cierra la sesión y avisa; el agente sigue abierto.
- Un fallo real: al abrir, el bot envió el formato antes de que el agente aceptara entrada. Corregido esperando a `interactive_ready`.

## Límites

- **opencode (0.13.0):** el envío ya no usa el panel del TUI (el Enter no enviaba el texto). Se usa `opencode run --session <id> --auto --format json <texto>` y la respuesta se lee de `session_message`. `--auto` aprueba los permisos sin preguntar. Está activado por defecto y se controla con `chat.opencode_auto` en `config.json` (ver 0.14.0).
- **opencode (0.12.0, anterior):** el lector lee `opencode.db` (SQLite, tablas `message` y `part`) y se verificó con una sesión real existente. **No se ha probado el envío a un agente opencode nuevo:** `agent.prompt` devolvió `done` pero el mensaje quedó en la caja de entrada del TUI y no hubo respuesta; el ID de sesión que da Herdr tampoco aparecía en la base. Hace falta investigar cómo entregar el texto al TUI de opencode.
- El lector usa `node:sqlite`, experimental en Node 22: imprime un aviso al cargarlo.
- Un mensaje que tarda más de 15 min se da por perdido en la respuesta; la cola sigue.
- Tras `salir`, los mensajes vuelven a ser órdenes normales del bot.

## Configuración de opencode (0.14.0)

En `config.json`:

```json
"chat": { "opencode_auto": true }
```

- `true` (por defecto): `opencode run --auto`. El agente aprueba sus permisos sin preguntar, como el modo automático de Claude en el panel.
- `false`: sin `--auto`. `opencode run` no tiene con quién confirmar un permiso; si el agente lo necesita, la sesión fallará en ese mensaje.

El cambio se aplica al reiniciar el bridge. Un valor que no sea booleano impide arrancar.
