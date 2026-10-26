# Evaluación de bibliotecas E2EE para el bot

Requisito del usuario (2026-10-25): **todas las salas cifradas**. Esto obliga a una biblioteca de Olm/Megolm: implementarla a mano está prohibido por la política de seguridad del proyecto ("no implementes algoritmos propios").

## Hallazgos

- **libolm (C/C++) está deprecada.** El equipo de Matrix la marcó como deprecada en 2024 y pide migrar a **vodozemac** (implementación Rust). Motivo: mantener dos stacks no es viable y se encontraron debilidades en las primitivas de libolm. Fuente: [libolm deprecation](https://matrix.org/blog/2024/08/libolm-deprecation/). [confirmado]
- **matrix-js-sdk** dejó su stack criptográfico legado y usa la implementación en Rust (`initRustCrypto()`). Según un commit de un tercero, la versión 37 eliminó el stack legado y el proyecto requiere Node.js 22 o superior. Fuente de terceros: [commit de skylar.tech](https://git.skylar.tech/skylord123/node-red-contrib-matrix-chat/src/commit/ebcb1eab81287d8a98af5410257280442588e114/package.json). [no verificado con la documentación oficial]
- **En Node no hay IndexedDB.** El store de crypto en Rust lo espera, así que se usa un shim (`fake-indexeddb`) y se guarda el estado en disco. Mismo commit de terceros. [no verificado]
- **matrix-nio (Python):** la búsqueda no encontró notas de versión sobre la migración a vodozemac. Estado actual [no verificado]. Recomendación de Matrix: vodozemac tiene bindings para JS y Python con API similar a libolm, pero eso no confirma que matrix-nio ya lo use. Fuente general: [libolm deprecation](https://matrix.org/blog/2024/08/libolm-deprecation/).

## Comparativa

| Criterio | matrix-js-sdk + crypto Rust (Node) | matrix-nio (Python) |
|---|---|---|
| Biblioteca de cifrado mantenida | Sí (vodozemac, según Matrix) | No confirmado |
| Riesgo de libolm deprecada | Bajo | Desconocido, hay que verificar |
| Coherencia con el resto del plan (Node) | Sí | No (lenguaje distinto) |
| Requisito de runtime | Node 22+ (según tercero) | Python + dependencias nativas |
| Complejidad extra | Shim de IndexedDB, persistencia de estado | Persistencia de estado |
| Dependencias | Alta (WASM, SDK completo) | Media |

## Recomendación

**matrix-js-sdk con crypto Rust (vodozemac)**, en Node.js. Es coherente con la decisión de lenguaje y con la biblioteca oficial de Matrix para JS.

Antes de adoptarla hay que confirmar, en un *spike* de Fase 0:

1. La versión mínima de Node y la documentación oficial de `initRustCrypto`, en lugar de la fuente de terceros.
2. Que el bot pueda **enviar y recibir** en una sala cifrada creada con `m.room.encryption`.
3. Persistencia del estado criptográfico en `state/crypto/` con permisos `0600`, y qué pasa si cambia el device ID.
4. Tamaño de dependencias y SBOM CycloneDX.
5. Verificación de dispositivos del remitente: el bot debe decidir si acepta mensajes de dispositivos no verificados (ver decisión abajo).

## Decisiones que cambian con E2EE

- **Dispositivos no verificados:** con E2EE, el remitente puede tener dispositivos sin verificar. Propuesta: el bot acepta órdenes solo de dispositivos del remitente que estén **cross-signed** o verificados; si no, responde pidiendo verificación. Esto es una decisión de seguridad que hay que confirmar.
- **Recuperación de claves:** si se pierde `state/crypto/`, el bot no puede leer mensajes históricos. Aceptable para v1; documentar.
- **Sala sin cifrado:** el bot rechaza operar. Debe comprobarse el evento `m.room.encryption` en el estado de la sala, no solo al crearla.

## Fuentes

- [libolm deprecation (matrix.org, 2024)](https://matrix.org/blog/2024/08/libolm-deprecation/)
- [Commit de tercero con migración a matrix-js-sdk 41.5.0 y `initRustCrypto`](https://git.skylar.tech/skylord123/node-red-contrib-matrix-chat/src/commit/ebcb1eab81287d8a98af5410257280442588e114/package.json) (fuente no oficial)
