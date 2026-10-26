# Esquema de la API de Herdr (verificado)

Fuente: `herdr api schema --output docs/herdr-schema.json` con `herdr 0.9.5` (`~/.local/bin/herdr`). El archivo JSON se guarda junto a este documento.

## Hallazgos que corrigen supuestos anteriores

| Supuesto anterior | Esquema real | Consecuencia |
|---|---|---|
| `workspace.id` | El campo es `workspace_id` (`WorkspaceInfo`). | El mapeo sala→workspace usa `workspace_id`. |
| `pane.exited` con campo de estado de salida | El evento `pane_exited` solo lleva `type` y `pane`. No hay código de salida. | El plugin no puede notificar el código de salida desde este evento. Se leería con `pane.read` o `session.snapshot`. |
| `events_lost` como error de suscripción | No aparece en el esquema. | Tratar la pérdida de eventos como señal de reconciliar con `session.snapshot`, no como código documentado. Pendiente de confirmar con una prueba real. |

## Nombres de eventos

- En el filtro de `events.subscribe` se usan nombres con punto: `pane.agent_status_changed`, `pane.exited`.
- En el tipo de evento recibido (`EventKind`) se usan guiones bajos: `pane_agent_status_changed`, `pane_exited`, `pane_output_changed`, `pane_created`, `pane_closed`, `workspace_closed`.

El plugin debe comparar contra el valor que llega en el evento (`type`) y usar el nombre con punto solo en la suscripción. Confirmar con una prueba antes de implementar.

## Métodos usados por el plan

Presentes en el esquema: `agent.list`, `events.subscribe`, `pane.read`, `pane.send_text`, `pane.send_keys`, `workspace.get`, `workspace.list`, `notification.show`.

## Comportamiento verificado en vivo (Fase 2, `herdr 0.9.5`)

- **Una petición por conexión.** Herdr cierra el socket tras cada respuesta normal. Solo `events.subscribe` mantiene la conexión abierta. El cliente abre una conexión por petición y una persistente para eventos. Escribir una segunda petición en la misma conexión provoca `EPIPE` o `ECONNRESET`.
- **`pane.agent_status_changed` exige `pane_id`** en la suscripción (`invalid_request: missing field pane_id`). Por eso el bridge no lo usa. Se suscribe a `pane.created`, `pane.closed`, `pane.exited`, `pane.updated`, `pane.agent_detected`, `workspace.created` y `workspace.closed`. Todas se aceptan, también combinadas.
- **Estado de agentes:** `agent.list` devuelve `pane_id`, `workspace_id`, `tab_id`, `agent`, `agent_status`, `state_change_seq` y `revision`. `workspace.list` devuelve `workspace_id` y `label`.
- **Cómo se usan los eventos:** son señales. Ante cualquier evento, el bridge vuelve a leer `agent.list` y compara con el estado guardado. No reproduce eventos.
- Sin verificar: el formato exacto de un evento real (`{ event, data }`) y el de `events_lost`. Ninguno se produjo durante la prueba en vivo.

## Estado de estos hallazgos

- Verificado: nombres de métodos, campo `workspace_id`, ausencia de código de salida en `pane_exited`.
- Pendiente: estabilidad de `workspace_id` entre reinicios de Herdr (ver `plans/06-plan.md`, Fase 0).
- Pendiente: comportamiento real de `events_lost` (no está en el esquema).
