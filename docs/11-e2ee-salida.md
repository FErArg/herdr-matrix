# E2EE de salida: cliente Matrix con crypto Rust

Estado: **implementado y verificado contra Synapse** (0.5.0). Un mensaje de prueba cifrado llegó a la sala de control: el servidor guarda `m.room.encrypted` y no hay texto en claro. En 0.6.0, el almacén se cifra en reposo y se añade el comando `verify`.

## Dependencias (decisión 12 del plan: excepción justificada)

| Paquete | Versión | Motivo |
|---|---|---|
| `matrix-js-sdk` | 43.0.0 | Cliente oficial con crypto Rust (vodozemac). libolm está deprecada (`docs/07`). |
| `@matrix-org/matrix-sdk-crypto-wasm` | 18.9.0 | Motor criptográfico que usa el SDK. |
| `fake-indexeddb` | 6.2.2 | IndexedDB para Node, que el crypto Rust requiere. Solo en memoria. |

Versiones fijas (`--save-exact`) y `package-lock.json` commiteado. Instalado con `--ignore-scripts`. No se implementa criptografía propia.

## Persistencia del dispositivo

El almacén criptográfico vive en `state/crypto/store.bin` (0600). El dispositivo es el de `session.json`:

- `setup` crea un login nuevo, así que borra `state/crypto/` (el almacén anterior no corresponde al dispositivo nuevo).
- `setup --logout` borra la sesión y el almacén.
- El bridge **no cierra sesión** al parar. Cerrarla invalidaría el dispositivo.

Como `fake-indexeddb` no persiste en disco, `src/crypto-store.mjs` vuelca las bases con prefijo `herdr-matrix` (structured clone de v8) al parar y cada 60 s, y las restaura antes de iniciar el cliente.

**Cifrado del volcado (0.6.0):** `store.bin` se cifra con AES-256-GCM. La clave aleatoria de 32 bytes está en `state/crypto/store.key` (0600). Cabecera `HMS1`, luego iv, tag y texto cifrado. Si falta `store.key` con un almacén cifrado, el bridge no arranca. Un `store.bin` sin cabecera (formato 0.5.0) se acepta una vez y se reescribe cifrado.

La clave no puede ir con una contraseña pedida en cada arranque: el bridge es un proceso desatendido. Por eso el cifrado protege copias sueltas de `store.bin`, no un lector del directorio de estado completo.

**Verificado:** dos ejecuciones seguidas con el mismo `session.json` dieron el mismo dispositivo (`RVNEYBOJHU`) y las mismas claves Ed25519 y Curve25519. El almacén se restauró desde `store.bin`. En 0.6.0, la primera ejecución migró el almacén en claro de 0.5.0 a cifrado, y las siguientes lo restauraron con `store.key`.

## Verificación del dispositivo (`verify`, 0.6.0)

`node src/index.mjs verify` pide la verificación al dueño en la sala de control y muestra un QR en la consola. El dueño lo escanea desde Element (Verificar por escaneo).

- Si el bot no tiene cross-signing, lo crea. Pide la contraseña de su cuenta sin eco, la usa solo para esa petición y no la guarda.
- Toma el bloqueo `bridge.lock`: no puede correr a la vez que `run`.
- Espera hasta 5 min a que el dueño acepte y otros 5 min al escaneo.
- El QR se dibuja con `qrcode-generator` (`src/qr.mjs`), en modo byte sin conversión de codificación.
- Sin terminal interactiva, falla antes de pedir la contraseña.

**Verificado (0.9.2):** el dispositivo del bot quedó verificado por emojis (SAS). Si el cliente del dueño puede escanear, se usa QR; si no, emojis. El QR con un móvil no se ha probado.

## Envío

`src/sender.mjs`: comprueba `isEncryptionEnabledInRoom`. Si la sala no tiene cifrado activo, rechaza el envío. Si está cifrada, envía con `sendTextMessage`, que cifra con Megolm.

## Verificado

- 38 pruebas (`npm test`).
- `setup` contra Synapse con dispositivo nuevo: OK.
- Envío de prueba a la sala de control: event id devuelto; el servidor guarda `m.room.encrypted`, sin `body`.
- Persistencia del dispositivo entre ejecuciones (ver arriba).
- `run`: arranca el cliente, registra la línea base, y se detiene con SIGINT liberando el bloqueo.

## Límites conocidos

- **Verificación del dispositivo:** el bot no está verificado por el dueño. Element mostrará el aviso de dispositivo no verificado. Pendiente (`plans/06-plan.md`, Fase 0 punto 5). El envío no depende de la verificación.
- **Clave junto al almacén:** `store.key` está en el mismo directorio que `store.bin`. Quien lea el directorio de estado puede descifrar. Mejora pendiente: guardar la clave en un almacén del sistema (keyring) o pedir una contraseña al arrancar, con un modo desatendido explícito.
- **Mensajes anteriores:** el SDK no puede descifrar mensajes enviados antes de este dispositivo (no hay backup de claves). Es el log con `DecryptionError` al arrancar. Son mensajes de otros, no errores del bot.
- **Ruido de log:** el SDK escribe trazas de depuración en stdout. Pendiente filtrarlas.
- **Sin reconexión:** igual que la fase 2.
