# Fase 2b: una sala cifrada por workspace

Estado: **implementada** en 0.6.0. Verificada en vivo con Herdr 0.9.5 y Synapse: alta, renombrado y archivado de un workspace de prueba.

## Qué hace

`node src/index.mjs run` mantiene, en cada reconciliación, una correspondencia entre los workspaces activos de Herdr (`workspace.list`) y `rooms[]` de `config.json`:

| Situación | Acción | Evento de Herdr que lo dispara |
|---|---|---|
| Workspace activo sin sala activa | Crea sala cifrada privada, invita al dueño, guarda el mapeo y escribe `dev.herdr.workspace` | `workspace.created`, o la primera reconciliación |
| Etiqueta distinta a la guardada | Renombra la sala (`m.room.name`) | `workspace.renamed` |
| Sala activa cuyo workspace ya no existe | Archiva: solo lectura (`events_default` 100), aviso final cifrado y estado `archived` | `workspace.closed` |

Reglas:

- Las notificaciones de agentes solo van a la sala activa de su workspace. Un evento sin sala activa se descarta (`routeRoom` devuelve `null`). Ya no hay sala de control de respaldo.
- Una sala archivada nunca se borra y nunca vuelve a recibir mensajes. Si el workspace reaparece con el mismo `workspace_id`, se crea una sala nueva.
- Cada reconciliación se ejecuta sola: una señal no se solapa con otra en curso.
- Un fallo en un workspace se registra y no detiene a los demás. Se reintenta en la siguiente reconciliación.

## Orden de operaciones

- **Alta:** la sala se crea y su mapeo se guarda *antes* de escribir `dev.herdr.workspace`. Si esa escritura falla, la siguiente reconciliación no crea una sala duplicada.
- **Archivado:** primero se cambia `events_default`, después se envía el aviso y por último se marca `archived`. Si algo falla antes del último paso, la sala sigue activa y se reintenta.

## Archivos

- `src/rooms.mjs`: gestor de salas (`createRoomManager`, `sync(workspaces)`).
- `src/outbound.mjs`: llama a `rooms.sync` con la lista de `workspace.list` antes de leer agentes; `routeRoom` solo enruta a salas activas; las reconciliaciones van en serie.
- `src/matrix.mjs`: `putState` y `getState` (eventos de estado).
- `src/bridge.mjs`: crea el gestor con el cliente HTTP y guarda `config.json` tras cada cambio.

## Verificado en vivo

Con el bridge en marcha contra Herdr 0.9.5 y Synapse:

1. Arranque con 5 workspaces activos: se crean 5 salas cifradas, con `dev.herdr.workspace` y `m.room.name` en el servidor.
2. `workspace.create` de un workspace de prueba → "sala creada para el workspace hm-prueba-2b".
3. `workspace.rename` → "sala renombrada a hm-prueba-2b-ren"; el nombre en el servidor coincide.
4. `workspace.close` → "sala archivada"; el servidor tiene `events_default` 100 y el aviso se envió.
5. Parada con SIGTERM: el proceso sale y libera `bridge.lock`.

El servidor acepta el tipo de evento de estado `dev.herdr.workspace`.

La sala `hm-prueba-2b-ren` queda archivada en el servidor. El plugin no borra salas.

## Límites

- **Invitación verificada en vivo (2026-10-26):** el dueño respondió con un MXID; la cuenta de prueba quedó invitada, aceptó por API, y una cuenta sin invitación recibió `403 M_FORBIDDEN` al intentar entrar en la sala de control.
- **Pregunta de invitado extra:** implementada en 0.9.0 (`src/invites.mjs`). Al crear una sala se pregunta en la sala de control. Solo el dueño responde: `no`, o un MXID que se valida con el perfil antes de invitar. Una pregunta activa a la vez, en orden. Sin respuesta en 10 min, caduca y no se invita a nadie. Las preguntas pendientes se guardan en `state/pending-invites.json` (0600). Tras un reinicio, se vuelve a preguntar la activa con 10 min nuevos.
- **Estabilidad de `workspace_id`:** no verificada entre reinicios de Herdr. Si cambia, el workspace se archiva y se crea una sala nueva. El cwd como clave alternativa queda pendiente.
- **Primera ejecución:** crea una sala por cada workspace activo sin consulta previa. Así lo pide el plan (arranque: reconciliación), pero conviene revisar la lista de workspaces antes del primer `run`.
- **Sin reconciliación de salas huérfanas:** una sala creada en el servidor pero no guardada en `config.json` (por un corte justo en el alta) no se detecta. El evento `dev.herdr.workspace` permitiría reconstruir el mapeo; esa reconstrucción no está implementada.
