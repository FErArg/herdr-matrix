# Fase 4: robustez

Estado: **implementada** en 0.8.0. 94 pruebas. Verificado en vivo: configuración real validada al arrancar, y parada limpia con SIGTERM bajo el supervisor.

## Qué hace

1. **Validación de `config.json` al arrancar** (`src/config-check.mjs`). Si falla, el bridge no abre el socket de Herdr, no toma el bloqueo y no conecta con Matrix. Comprueba: `config_version`, URL https, MXID del dueño, ID de sala de control, `rooms[]` (workspace, sala, estado) y tipos de `notify_events`.
2. **Supervisor** (`src/supervisor.mjs`). Reinicia `runBridge` con backoff exponencial: 1 s, 2 s, 4 s… con tope de 60 s. Tras 5 fallos seguidos sale con el último error. Una ejecución que dura más de 5 minutos reinicia el contador.
3. **Errores fatales** (`fatal: true`): configuración inválida, config o sesión ausentes. No se reintentan.
4. **Suscripción cerrada**: ahora es un fallo y no una parada normal, así que el supervisor la reinicia.
5. **README del plugin** (`README.md`): instalación, configuración, órdenes, riesgos y rotación.

## Errores encontrados en vivo

- La validación inicial rechazaba la configuración real: exigía `:servidor` en los IDs de sala, pero Matrix v3+ usa IDs opacos (`!abc`). Corregido; la prueba en vivo lo detectó antes del commit.

## Verificado en vivo (2026-10-26)

- Supervisor con Matrix inaccesible (copia de sesión apuntando a un puerto cerrado): reintentos de 1, 2, 4 y 8 s; tras 5 fallos, salida con código 1 y sin procesos ni bloqueo. El servidor real no se tocó.

## Verificado en pruebas

- 94 pruebas (`npm test`): 6 nuevas de validación y 6 del supervisor (backoff, reintentos, fatal, agotamiento, reinicio por ejecución estable, señal durante la espera).
- `run` con la configuración real: pasa la validación, arranca, y con SIGTERM termina sin dejar `bridge.lock`.

## Límites

- **Sin reconexión de Matrix por el supervisor.** El SDK reintenta su propia sincronización. Si el arranque del cliente falla, el supervisor lo reintenta, pero no se ha probado una caída del servidor durante una sesión.
- **Membresía sin caché.** Ver `docs/13-fase3-entrada.md`: se usa el estado de sala del SDK, no `joined_members` cada 60 s.
- **Sin prueba de la caída de Herdr en vivo.** El backoff de Herdr se probó con funciones simuladas; el de Matrix, en vivo.
- **Sin rotación automática de logs.** `audit.log` crece; el plan no pide rotación.
