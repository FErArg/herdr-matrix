# Análisis: una sala por proyecto activo en Herdr

Pregunta del usuario (2026-10-25): incluir una sala separada por cada proyecto activo de Herdr.

## Modelo propuesto

En Herdr, un **workspace** representa un proyecto. Propuesta: **un workspace = una sala Matrix cifrada**.

```
workspace "demo" (w1) ──► sala "[demo] estado y órdenes"
workspace "herdr-matrix" (w2) ──► sala "[herdr-matrix] estado y órdenes"
(sala de control, opcional) ──► órdenes globales: listar proyectos, crear sala
```

- **Notificaciones:** un evento de un panel se publica solo en la sala de su workspace.
- **Órdenes:** un mensaje en la sala de un workspace solo puede afectar a paneles de **ese** workspace. La relación sala↔workspace se decide en el servidor del plugin, nunca por lo que el mensaje dice.
- **Sala de control:** solo para órdenes globales (`proyectos`, `estado` de todo). Opcional.

## Por qué así

- **Aislamiento:** un remitente invitado a un proyecto no ve ni controla los demás. Es el control de seguridad principal de este diseño.
- **Invitaciones por sala:** cada sala tiene su propia lista de remitentes. Dar acceso a un proyecto no da acceso a otros.
- **Claridad:** cada proyecto tiene su historial de notificaciones.

## Fuentes de datos en Herdr (socket API, `docs/02-herdr-socket-api.md`)

- `workspace.list`, `workspace.get`: listar y leer workspaces.
- Eventos `workspace.created`, `workspace.renamed`, `workspace.closed`, `workspace.focused`: sincronizar salas con el ciclo de vida del proyecto.
- `pane.*` filtrados por workspace: validar que un panel pertenece a la sala.

**No verificado:** qué campos tiene `workspace` (id, label, cwd) y si el id es estable entre reinicios de Herdr. Se verifica con `herdr api schema --json` en la fase 0. Si el id no es estable, el mapeo debe usar otra clave (por ejemplo, el cwd).

## Ciclo de vida

| Evento de Herdr | Acción del plugin |
|---|---|
| `workspace.created` | Crea sala cifrada, invita a `allowed_senders` del proyecto (o a la lista por defecto), guarda el mapeo. Publica un mensaje de bienvenida con los paneles. |
| `workspace.renamed` | Actualiza el nombre de la sala (`m.room.name`). |
| `workspace.closed` | Publica un aviso "proyecto cerrado". **No borra la sala** (mantiene historial). Marca el mapeo como archivado y deja de enrutar. |
| Arranque del plugin | Reconcilia: workspaces activos sin sala → crear; salas de proyectos cerrados → archivar. |

## Autorización por sala (clave de seguridad)

El bot decide a qué workspace pertenece cada sala con su propia configuración. El mensaje nunca lo indica.

1. Se recibe un mensaje en la sala R.
2. Se busca el workspace W asociado a R en la config (`rooms[]`).
3. Se verifica que el remitente esté en `rooms[R].allowed_senders` y sea miembro de R.
4. Se valida que el panel del comando pertenezca a W (lo consulta el bot con Herdr, no lo afirma el mensaje).
5. Solo entonces se ejecuta la orden.

Si el paso 4 falla, la respuesta es genérica y se registra en `audit.log`.

## Configuración propuesta

```json
{
  "config_version": 2,
  "defaults": { "allowed_senders": ["@owner:hs.example.org"] },
  "control_room": { "room_id": "!control:...", "allowed_senders": ["@owner:hs.example.org"] },
  "rooms": [
    {
      "workspace_id": "w1",
      "workspace_label": "demo",
      "room_id": "!abc:...",
      "allowed_senders": ["@owner:hs.example.org"],
      "status": "active"
    }
  ]
}
```

Los `room_id` son datos de configuración, no secretos. Permisos `0600` igualmente, porque contienen MXID de terceros (dato personal).

## Recuperación del mapeo

Si se pierde `config.json`, el mapeo se puede reconstruir. Propuesta: guardar el id del workspace en un **evento de estado personalizado** de la sala (por ejemplo `dev.herdr.workspace`, con espacio de nombres propio). Así, al arrancar, el bot lee el estado de cada sala que es miembro y reconstruye el mapeo. Verificar que el servidor admite tipos de evento personalizados (esperado, no probado).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Muchas salas: ruido y costo de cifrado | Crear salas solo para workspaces activos; archivar los cerrados. |
| Creación masiva de salas (abuso o bug) | Límite de salas por hora; confirmación para crear salas en lote. |
| Mapeo incorrecto → notificaciones a sala equivocada | Mapeo solo en config/estado del bot; validación de pertenencia del panel antes de publicar. |
| Invitación a sala equivocada | Lista de invitados por sala, no global. Confirmación al cambiar invitados. |
| Workspace reutiliza un id tras cerrarse | Mapeo por id + label; si el id no es estable, usar otra clave (ver "No verificado"). |
| Herdr reinicia y pierde workspaces | Reconciliación al arrancar; no archivar salas por ausencia temporal sin confirmación. |

## Alternativas consideradas

- **Una sola sala con hilos (threads) por proyecto:** menos salas, pero el aislamiento es solo visual; un miembro de la sala ve todos los proyectos. Descartada por el requisito de aislamiento.
- **Un Space de Matrix con salas por proyecto:** útil para navegación en el cliente, pero no cambia la autorización. Se puede agregar después.
- **Una sala por panel:** demasiadas salas. Descartada.

## Impacto en el plan

- Fase 1: `setup` crea la sala de control (opcional) y la configuración `rooms[]` vacía.
- Fase 2: salida enrutada por workspace; el notifier usa el mapeo.
- Fase 3: el dispatcher valida workspace de la sala antes de cada orden.
- Nueva fase o subfase: ciclo de vida de salas (creación, renombrado, archivo, reconciliación).

## Preguntas abiertas para el usuario

1. ¿Querés sala de control además de las salas por proyecto?
2. ¿Quién se invita por defecto a cada sala nueva?
3. ¿Los proyectos cerrados deben quedar archivados (solo lectura) o salir del bot?
4. ¿Crear salas automáticamente al abrir un workspace, o solo bajo demanda con un comando?
