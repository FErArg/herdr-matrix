# Recuperar el dispositivo del bot (almacén criptográfico desincronizado)

Síntoma: `verify` no envía la solicitud, no llega nada a Element, y la consola muestra:

```
Failed to process outgoing request 0: M_UNKNOWN: MatrixError: [400] One time key signed_curve25519:AAAAAAAAAA4 already exists.
```

Reiniciar el bridge no lo arregla: el error vuelve en cada arranque.

Causa probable: el almacén local del bot no coincide con lo que el servidor ya tiene para ese dispositivo. Suele pasar si dos procesos (bridge `run` y `verify`) usaron el mismo almacén a la vez, o si el almacén restaurado es más antiguo que lo subido al servidor. El almacén no se repara desde dentro, así que se crea un dispositivo nuevo.

Consecuencia: el bot queda con un dispositivo nuevo y hay que verificarlo en Element otra vez.

Qué hace cada comando (según `src/setup.mjs`):

- `setup` revoca la sesión anterior si existe, inicia sesión de nuevo (crea un dispositivo nuevo) y borra el almacén criptográfico. Pide la URL del servidor, el usuario y la contraseña del bot, y el MXID del dueño. La sala de control se conserva si ya está en la configuración; solo se crea si falta.
- `setup --logout` solo revoca la sesión y borra el almacén. No hace falta ejecutarlo antes de `setup`.

## Antes de empezar

1. Para el bridge: mata el proceso `node src/index.mjs run`. Si Herdr lo vuelve a lanzar, desactiva el plugin desde Herdr mientras dure el procedimiento.
2. Para cualquier `verify` que siga en marcha.
3. Comprueba que no quedan procesos:

```
pgrep -fl "src/index.mjs"
```

No debe salir nada. Si sale algo, páralo antes de seguir.

## Pasos

1. Crea la sesión nueva, con el bridge parado:

```
node src/index.mjs setup
```

2. Verifica el dispositivo nuevo, con el bridge parado:

```
node src/index.mjs verify
```

Espera a ver la línea "solicitud enviada al dueño en la sala de control: acéptala en Element".

3. En Element, abre la sala de control ("herdr-matrix control") y acepta la solicitud de verificación. La solicitud tiene 5 minutos de plazo.

4. Si la consola pide la contraseña de la cuenta del bot para crear el cross-signing, escríbela. No se guarda.

5. Compara los emojis que muestra la consola con los de Element y confirma en ambos lados. La verificación es solo por emojis; no hay QR.

6. Cuando salga "dispositivo del bot verificado", arranca el bridge de nuevo. Puedes hacerlo con `node src/index.mjs startup`, que lo lanza en segundo plano, o con `node src/index.mjs run` en una terminal.

## Comprobaciones finales

- En Element, el dispositivo del bot aparece como verificado.
- En `~/.local/state/herdr-matrix/bridge.log` no aparece "Failed to process outgoing request" después del arranque.
- Un mensaje de prueba del bot llega a la sala de control y se muestra como cifrado y verificado.

## Cambiar a una cuenta nueva del bot

Si la cuenta antigua no se puede verificar (por ejemplo, el cross-signing falla y el servidor no acepta la firma del dispositivo), lo más simple es usar una cuenta nueva del bot. Procedimiento probado:

1. Crea la cuenta nueva en el servidor y anota su MXID.
2. Para el bridge y comprueba que no quedan procesos, como en "Antes de empezar".
3. Haz copia de `~/.config/herdr-matrix/config.json` y quita de ella `control_room_id`, `rooms` y `tab_rooms`. Si no se quita la sala de control, `setup` la conserva y la cuenta nueva no tendrá acceso a ella.
4. Ejecuta `node src/index.mjs setup` con las credenciales de la cuenta nueva. Luego sigue desde el paso 2 de "Pasos".
5. Cuando el bridge arranque, crea sus salas nuevas. Las salas de la cuenta antigua no se borran solas: hay que salir de ellas desde un cliente de la cuenta antigua.

## Si algo falla

- Si `verify` no llega a Element, mira primero si la línea "solicitud enviada" aparece en consola. Si no aparece, el proceso se queda antes de enviar la solicitud.
- Si vuelve a aparecer el error de claves de un solo uso después de `setup`, revisa que no quede ningún proceso `src/index.mjs` en marcha antes de repetir los pasos.
