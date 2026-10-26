# Matrix y Synapse

Fuentes:
- Synapse: https://element-hq.github.io/synapse/latest/
- Instalación: https://element-hq.github.io/synapse/latest/setup/installation.html
- Admin API (usuarios): https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html
- Client-Server API: https://spec.matrix.org/latest/client-server-api/ (v1.19; se leyó solo el índice y parte de las secciones).

## 1. Servidor Synapse (lado servidor)

### Instalación [confirmado]

Opciones documentadas: paquete Debian/Ubuntu (`matrix-synapse-py3`), Docker (`matrixdotorg/synapse` o `ghcr.io/element-hq/synapse`), o PyPI en virtualenv (Python 3.10–3.13).

```sh
mkdir -p ~/synapse
virtualenv -p python3 ~/synapse/env
source ~/synapse/env/bin/activate
pip install --upgrade pip setuptools
pip install matrix-synapse
```

Generar la configuración:

```sh
cd ~/synapse
python -m synapse.app.homeserver \
    --server-name my.domain.name \
    --config-path homeserver.yaml \
    --generate-config \
    --report-stats=no
```

- `--server-name` **no se puede cambiar después**.
- Genera las claves de firma: hacer backup.

Arrancar: `synctl start` (desde el directorio con el venv activo).

### Registrar un usuario [confirmado en parte]

```sh
register_new_matrix_user -c homeserver.yaml
```

- Pide localpart, contraseña, confirmación y "Make admin". Necesita el servidor corriendo y `registration_shared_secret` en la config.
- La doc solo documenta `-c`. Los flags `-u`, `-p`, `-a`, `--no-admin` **[verificar]** con `register_new_matrix_user --help`.

### Admin API: crear o modificar usuario [confirmado]

```
PUT /_synapse/admin/v2/users/<user_id>
Authorization: Bearer <access_token de admin>
```

Body de ejemplo:

```json
{
    "password": "user_password",
    "logout_devices": false,
    "displayname": "Alice Marigold",
    "admin": false,
    "deactivated": false,
    "user_type": null,
    "locked": false
}
```

- Respuestas: `201` usuario nuevo, `200` modificado.
- `password`, `displayname`, `threepids`, `external_ids`, `avatar_url`, `user_type` son opcionales.

Otros endpoints confirmados:

- Desactivar: `POST /_synapse/admin/v1/deactivate/<user_id>` con `{"erase": true}` (opcional).
- Listar: `GET /_synapse/admin/v2/users?from=0&limit=10&guests=false`.

Autenticación de la Admin API: access token de un admin como Bearer. La doc **recomienda no exponer `/_synapse/admin/...` públicamente**: hay que bloquearlo en el reverse proxy y llamarlo desde el host.

Promover a admin (SQL, la doc lo muestra directamente):

```sql
UPDATE users SET admin = 1 WHERE name = '@foo:bar.com';
```

### Admin API de salas [no encontrado]

La página índice de la Admin API no enlaza a una sección de salas. Hay que buscar `room_admin_api` o revisar la doc de Synapse. No se verificó.

## 2. Client-Server API (lo que usa el plugin)

El plugin actúa como **un cliente Matrix** con cuenta propia (bot). Endpoints de la spec v1.19 [confirmado en el índice]:

| Operación | Endpoint | Notas |
|---|---|---|
| Login | `POST /_matrix/client/v3/login` | Tipo `m.login.password`. `identifier` con `m.id.user` (usuario o localpart). Devuelve `access_token`. |
| Quién soy | `GET /_matrix/client/v3/account/whoami` | Útil para validar el token al configurar. |
| Crear sala | `POST /_matrix/client/v3/createRoom` | Campos: ver abajo. |
| Invitar | `POST /_matrix/client/v3/rooms/{roomId}/invite` | Body `{"user_id": "@usuario:servidor"}` [verificar]. |
| Unirse | `POST /_matrix/client/v3/rooms/{roomId}/join` o `/join/{roomIdOrAlias}` | Para el usuario remoto si no se invita. |
| Enviar mensaje | `PUT /_matrix/client/v3/rooms/{roomId}/send/{eventType}/{txnId}` | `txnId` = id de transacción del cliente, para idempotencia. Tipo típico `m.room.message`. |
| Sincronizar | `GET /_matrix/client/v3/sync` | Long-poll. Parámetros `since`, `timeout`, `filter` [verificar detalles]. |

### Login: body [verificar]

```json
{
  "type": "m.login.password",
  "identifier": { "type": "m.id.user", "user": "bot-demo" },
  "password": "..."
}
```

Recomendación: el plugin pide la contraseña **una sola vez**, guarda el `access_token` y el `device_id`, y descarta la contraseña.

### createRoom: campos [verificar]

Campos que se espera aceptar: `name`, `topic`, `preset` (`private_chat`, `trusted_private_chat`, `public_chat`), `visibility` (`private` / `public`), `room_alias_name`, `invite` (lista de `user_id`), `is_direct`, `initial_state`, `creation_content`, `power_level_content_override`.

Ejemplo de sala privada con invitación:

```json
{
  "name": "herdr-matrix",
  "preset": "trusted_private_chat",
  "invite": ["@owner:hs.example.org"],
  "is_direct": false
}
```

Respuesta: `room_id`. Hay que verificar en la spec si `invite` en `createRoom` ya llega a la persona o si basta con el invite posterior.

### Sync y long-polling [verificar]

- Primera llamada sin `since` (estado completo, puede ser grande; conviene un `filter` que limite eventos).
- Las siguientes con `since=<next_batch>` y `timeout=<ms>`: el servidor retiene la conexión hasta que haya eventos.
- Guardar `next_batch` en `HERDR_PLUGIN_STATE_DIR` para no reprocesar mensajes al reiniciar.

### Idempotencia

- Usar un `txnId` distinto por mensaje (por ejemplo, un contador o un UUID). Si se reintenta con el mismo `txnId`, Matrix devuelve la misma respuesta y no duplica el mensaje. [confirmado en el índice]

## 3. Cifrado (E2EE) — pendiente de decidir

- Las salas `trusted_private_chat` y `private_chat` **no** están cifradas por defecto en Synapse salvo configuración (`encryption_enabled_by_default_for_room_type`) [verificar].
- Si se quiere cifrado extremo a extremo, el bot necesita soporte Olm/Megolm (biblioteca tipo `matrix-nio` con `libolm`, o `matrix-rust-sdk`). Es bastante más complejo y hay que gestionar claves de dispositivo.
- Esto es una decisión importante: ver `05-preguntas.md`.

## 4. Riesgos conocidos

- El access token da control total de la cuenta bot. Guardarlo fuera del repo, permisos `0600`.
- Cualquiera invitado a la sala podría enviar órdenes. Hay que filtrar por `sender` contra una lista de usuarios autorizados.
- Synapse usa `8008` por defecto en el ejemplo de la doc; en producción va detrás de un reverse proxy con TLS.
