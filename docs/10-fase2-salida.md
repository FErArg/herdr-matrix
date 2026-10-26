# Fase 2: salida Herdr → Matrix

Estado: **implementada**. El envío a salas cifradas funciona desde 0.5.0 (`docs/11-e2ee-salida.md`). Verificado el envío de un mensaje cifrado a la sala de control; **no** se ha observado todavía una transición real de agente de punta a punta.

## Qué hace

`node src/index.mjs run` mantiene un bridge que:

1. Comprueba que el socket de Herdr sea un socket del usuario actual (`assertSafeSocket`).
2. Toma un bloqueo de instancia única (`state/bridge.lock` con el PID; un bloqueo de un PID muerto se reemplaza).
3. Se suscribe a los eventos de Herdr (`SUBSCRIPTION_TYPES` en `src/outbound.mjs`).
4. En la primera lectura solo registra una **línea base**. No notifica nada.
5. Ante cada evento, o cada 30 s como red de seguridad, vuelve a leer `agent.list` y `workspace.list`, compara con el estado guardado (`state/herdr-snapshot.json`) y genera mensajes para las transiciones configuradas.
6. Al recibir SIGINT o SIGTERM, cierra la suscripción y libera el bloqueo.

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Suscripción | Sin filtro por `pane_id`. | `pane.agent_status_changed` exige `pane_id` (verificado). Se usan señales de estructura y se re-lee el estado. |
| Eventos perdidos | Re-leer estado, no reproducir. | Lo indica la doc de Herdr (`docs/02`). |
| Conexiones | Una por petición; una persistente para eventos. | Herdr cierra tras cada respuesta normal (verificado). |
| Formato | `[workspace/tab/panel] estado: texto`. Texto plano, saneado. | Sin fragmentos de salida de agentes en v1. Sin saltos de línea. |
| Frecuencia | Un mensaje por panel cada 10 s; el resto se descarta. | Límite de la Fase 2. |
| Notificaciones | Por defecto `blocked`, `done` y `exited`. Configurable con `notify_events`. | Plan, decisión 4. |
| `exited` | Se llama "panel cerrado", no "con error". | `pane_exited` no trae código de salida (verificado en el esquema). |
| Destino | Sala activa del workspace en `rooms[]`; si no hay, el evento se descarta. | Desde 0.6.0 (Fase 2b, `docs/12-fase2b-salas.md`). Antes, la sala de control hacía de respaldo. |
| Envío | Nunca en claro a una sala cifrada. | Decisión 10 del plan: E2EE obligatorio. |

## Envío cifrado

Todas las salas son cifradas (decisión 10). El envío usa el cliente de `matrix-js-sdk` con crypto Rust (`src/sender.mjs`, `src/bot-client.mjs`, `docs/11-e2ee-salida.md`). Si la sala no tiene cifrado activo, el envío se rechaza con `la sala no está cifrada; no se envía`.

## Verificado

- 38 pruebas (`npm test`), incluidas las de socket con un servidor simulado que cierra la conexión tras cada petición.
- Contra el Herdr real (`0.9.5`): `ping`, `agent.list` y `workspace.list` responden; la suscripción con los 7 tipos se confirma; la línea base registra 4 paneles; el bridge arranca, mantiene la suscripción y se detiene con SIGINT, liberando el bloqueo.
- No verificado en vivo: una transición real de estado (`working` → `blocked`). No se forzó ningún cambio en agentes del usuario. El formato de un evento real y de `events_lost` tampoco se observó.

## Límites

- Sin reconexión automática: si la suscripción se cierra, el bridge sale con error.
- Fase 2b implementada en 0.6.0: las salas por workspace se crean, renombran y archivan (`docs/12-fase2b-salas.md`).
- Sin `txnId` persistido: el SDK gestiona los identificadores de transacción.
- La Herdr de la prueba tiene 4 workspaces activos (`w1`–`w4`); la estabilidad de `workspace_id` entre reinicios sigue pendiente (Fase 0).

## Cómo ejecutarlo

Desde el directorio del plugin, con `setup` ya hecho:

```
node src/index.mjs run
```

Configuración: `config.json` (`rooms`, `notify_events`, `control_room_id`). Estado: `session.json`, `herdr-snapshot.json`, `bridge.lock`, todos en el directorio de estado del plugin.
