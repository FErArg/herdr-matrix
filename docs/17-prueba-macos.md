# Prueba en macOS

Estado: **pendiente de validación en Mac**. El manifiesto declara `platforms = ["linux", "macos"]` por decisión aprobada el 2026-10-26, antes de pasar la lista de comprobaciones. Hasta que se complete, no hay evidencia de funcionamiento en macOS.

## Revisión del código (2026-10-26)

- Sin dependencias de Linux: no se usa `/proc`. Las rutas salen de `homedir()`; las variables XDG tienen valor por defecto.
- Permisos 0600/0700 y `process.getuid()`: disponibles en macOS.
- Las dependencias son JavaScript y WebAssembly (`matrix-js-sdk`, `@matrix-org/matrix-sdk-crypto-wasm`, `fake-indexeddb`): sin binarios nativos, así que el mismo `node_modules` sirve.

## Puntos que hay que confirmar en el Mac

1. **Socket de Herdr.** El valor por defecto es `~/.config/herdr/herdr.sock`. Confirmar la ruta real con `herdr` en macOS; si es otra, usar `HERDR_SOCKET_PATH`.
2. **Datos de opencode.** Por defecto `~/.local/share/opencode/opencode.db`. Confirmar con `ls` tras una sesión.
3. **Transcripciones de Claude Code.** `~/.claude/projects/`. Confirmar tras una sesión.
4. **Node 22 o superior** instalado.

## Pasos

Desde el directorio del instalable (`Herdr-Matrix-v0.16.0-macos-<arch>` tras extraerlo):

```
node --version                       # debe ser 22 o superior
node src/index.mjs                   # debe mostrar el uso y salir con código 2
node src/index.mjs setup             # URL, usuario, contraseña, dueño y sala de control
node src/index.mjs verify            # verificación del dispositivo (emojis o QR)
node src/index.mjs run               # bridge: observar la línea base y los eventos
```

Comprobar en el Mac:
- `setup` crea la sala de control cifrada y el dueño puede unirse.
- `run` registra la línea base y crea salas por workspace.
- `estado` desde la sala de control responde con los agentes.
- `setup --logout` revoca la sesión y borra el almacén.

## Criterio para declarar macOS

Todos los pasos anteriores pasan en un Mac real, y la auditoría muestra las órdenes como `ok`. Entonces se añade `macos` a `platforms` y se publica un instalable para macOS.
