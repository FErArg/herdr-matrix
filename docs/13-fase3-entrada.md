# Fase 3: entrada, de la sala a Herdr

Estado: **implementada** en 0.7.0 y **verificada en vivo** para `estado`, `enviar` con `confirmar` y `enter` con `confirmar`, desde la sala de control y la sala de un espacio (2026-10-26). **`leer` procesado en vivo** en el panel de `ferny` (`w3:p1`): auditoría `ok` y contenido publicado confirmado por el dueño en Element. Fase 3 verificada en vivo en todas sus órdenes.

## Qué hace

`node src/index.mjs run` escucha el cliente del bot. Cada mensaje de texto de una sala cifrada pasa por `src/inbound.mjs`, en este orden:

1. **Sala**: la de control, o una sala activa de workspace. Debe estar cifrada.
2. **Remitente**: el dueño (`config.owner`), y miembro `join` de la sala. Si falla, no hay respuesta; solo auditoría.
3. **Mensaje reciente**: `origin_server_ts` a menos de 60 s. Los mensajes del propio bot se ignoran.
4. **Orden**: el verbo está en la tabla y los argumentos son válidos (`src/commands.mjs`).
5. **Alcance**: la sala de control solo lee (`estado`, `leer`); la escritura va en la sala del espacio del panel.
6. **Escritura**: `enviar` y `enter` piden confirmación.

## Tabla de órdenes

| Verbo | Método de Herdr | Escritura | Argumentos |
|---|---|---|---|
| `estado` | `agent.list` | no | ninguno |
| `leer <panel>` | `pane.read` (últimas 20 líneas, sin ANSI) | no | panel `wN:pM` |
| `enviar <panel> <texto>` | `pane.send_text` | sí, con confirmación | panel y texto (≤ 500 caracteres, sin control) |
| `enter <panel>` | `pane.send_keys` (`["enter"]`) | sí, con confirmación | panel |
| `confirmar` | ejecuta la acción pendiente | — | — |

La tabla está en código (`src/commands.mjs`), no en `config.json`. Quien pueda editar la config no puede añadir métodos de Herdr. El chat solo elige el verbo.

## Interpretación determinista (0.10.0)

Sin modelo de lenguaje. El parser reconoce:

- **Sinónimos fijos** por verbo: `estado` = estados, status, agentes, lista; `leer` = lee, read, mostrar, salida; `enviar` = envía, envio, escribir, escribe, send; `enter` = intro, pulsar, return. Tildes y mayúsculas no cuentan.
- **Una letra de error** en palabras de 5 o más letras, solo para `estado` y `leer`. Nunca para `enviar` ni `enter`: una errata no puede llegar a una escritura.
- **Panel** en formato `w2:p1`, `W2:P1`, `w2.p1` o `w2 p1`.
- **Confirmación** con `confirmar`, `confirma`, `confirmo`, `sí`, `si` u `ok`, solo si hay una acción pendiente.

Nunca se elige un método de Herdr: la interpretación solo devuelve un verbo de la tabla.

## Confirmación

- Una sola acción pendiente por remitente, en la sala donde se pidió.
- `confirmar` la ejecuta si llega antes de 60 s y desde la misma sala.
- Cualquier otro mensaje la cancela. La cancelación se audita.
- El texto de `enviar` no se repite en la sala: la confirmación solo nombra el verbo y el panel.

## Límites y frecuencia

- 10 órdenes por remitente y minuto. Se cuentan las órdenes válidas; las rechazadas por formato no.
- Un fallo de Herdr devuelve "no se pudo ejecutar la orden." y se audita con el detalle.

## Auditoría

`state/audit.log` (0600), una línea por orden: `fecha, remitente, sala, verbo, panel, resultado`, separadas por tabuladores. Los saltos de línea, tabuladores y barras se escapan. **El texto de `enviar` no se registra.** Las órdenes de remitentes no autorizados también quedan registradas, como `no autorizado`, sin respuesta a la sala.

## Archivos

- `src/commands.mjs`: tabla y parser puros.
- `src/inbound.mjs`: autorización, alcance, confirmación, límite de frecuencia y ejecución. Recibe sus dependencias (cliente de Herdr, remitente, cifrado, membresía, auditoría), así que se prueba sin servidor.
- `src/inbound-events.mjs`: conecta el SDK con `inbound.mjs`. Procesa el evento descifrado (`Decrypted`) y el `Timeline` en vivo, no el historial paginado. Un mismo evento se procesa una vez.
- `src/audit.mjs`: registro de auditoría.
- `src/bridge.mjs`: crea el módulo de entrada y lo conecta al cliente; se desconecta al parar.

## Desviaciones respecto al plan (`plans/06-plan.md`, Fase 3)

- **Membresía:** se consulta el estado de sala del SDK (`getRoom().getMember()`), no un `joined_members` cacheado 60 s. Es el estado en vivo y no necesita caché.
- **`allowed_panes`:** no se usa. El alcance lo fija la sala: la de control no escribe, y la de un espacio solo escribe en sus paneles. Es más estricto que una lista por sala, pero el plan no define esa lista con precisión.
- **`next_batch`:** no se persiste. El SDK hace una sincronización inicial al arrancar. Con el filtro de 60 s, las órdenes enviadas mientras el bot estaba caído no se ejecutan.
- **Tabla en código:** ver arriba.

## Verificado en vivo (2026-10-26)

- `estado` desde la sala de control: lista los agentes de todos los espacios. Desde la sala de un espacio: solo los suyos.
- `enviar w2:p1 …` + `confirmar`: el texto llegó a la caja de entrada del panel.
- `enter w2:p1` + `confirmar`: pulsó Enter (la sesión del panel procesó el texto como prompt).
- Órdenes rechazadas: `Confirmar,` (corregido en 0.8.2), y una orden sin verbo, auditadas con su primera palabra.

## Verificado en pruebas

- `pane.read` devuelve `read.text` (sonda en vivo sobre `w4:p1`); el código lo usa así.
- El bridge arranca con la entrada conectada, sincroniza, no escribe nada y se detiene con SIGTERM liberando el bloqueo.
- Pruebas con fakes de Herdr y de Matrix: 82 en total, incluidas las 28 de esta fase (parser, confirmación, caducidad, cancelación, alcance, autorización, frecuencia, auditoría sin texto y fallo de Herdr).

## Límites

- **`leer` publica la salida del panel en la sala.** Usar solo paneles sin contenido sensible.

- **Sin prueba en vivo de una orden real.** Hace falta un mensaje del dueño en una sala. Con una segunda cuenta, o con el dueño escribiendo en Element, se cierra. El plan pedía una segunda cuenta de prueba (Fase 0, punto 1), que no existe.
- **`leer` envía salida del panel a la sala.** Puede incluir secretos que el panel muestre. Las 20 últimas líneas y 1500 caracteres son el límite de exposición. Revisar antes de usarlo con paneles sensibles.
- **Sin reconexión de la sincronización.** Si el SDK pierde la sesión, el bridge depende de su propio reintento. Fase 4.
- **Pregunta de invitado extra en la sala de control (Fase 2b):** sigue sin implementar. Ahora que hay lectura de respuestas, es posible; queda como trabajo pendiente.
