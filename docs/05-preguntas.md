# Preguntas abiertas

Necesito estas respuestas para pasar del análisis a la implementación. Las marcadas con ★ son las que más cambian el diseño.

## Servidor Matrix

1. ★ **¿Ya tenés un servidor Synapse corriendo?** ¿Dónde (local, VPS, Docker), con qué dominio, y con TLS/reverse proxy?
2. **¿Tenés acceso de admin** al servidor (para crear el usuario bot con `register_new_matrix_user` o la Admin API), o el bot tiene que registrarse de otra forma?
3. **¿Querés usar el servidor propio o uno público** (matrix.org, etc.)? Con un servidor público, la creación de usuarios bot y la federación cambian.

## Cuentas y sala

4. ★ **¿Qué cuenta usa el plugin?** ¿Una cuenta bot dedicada (recomendado) o tu propia cuenta?
5. ★ **¿La sala debe ser privada e invitación-only**, o puede ser pública con alias?
6. **¿Cifrado E2EE?** Sin cifrado el bot es mucho más simple. Con cifrado hay que manejar claves Olm/Megolm y verificación de dispositivos.
7. **¿Cuántas salas por instalación?** Una por máquina Herdr, o una por workspace/proyecto?
8. **Invitación:** ¿el flujo de "pedir username y invitar" es suficiente, o también querés "crear enlace/alias para unirse"?

## Qué notificar

9. ★ **¿Qué eventos de Herdr disparan notificaciones?** Propongo como mínimo: agente pasa a `blocked` (necesita respuesta), agente pasa a `done`, panel terminado con error. ¿Agregás algo (patrones de salida con `pane.output_matched`, creación de workspace/worktree)?
10. **¿Querés que la notificación incluya fragmento de salida** del agente? Esto puede exponer código o secretos en la sala; conviene saberlo.
11. **¿Frecuencia y ruido:** notificar cada cambio, o agrupar/limitar (por ejemplo, máximo una cada N segundos por agente)?

## Qué órdenes puede dar el usuario remoto

12. ★ **¿Qué órdenes querés desde el chat?** Propuesta inicial: `estado`, `leer <panel>`, `enviar <panel> <texto>`, `enter <panel>`. ¿Algo más o menos?
13. ★ **¿Enviar texto libre a un agente** (`agent.prompt`) está permitido, o solo acciones predefinidas? Enviar texto libre a un agente tiene riesgo si el agente puede ejecutar comandos.
14. **¿Hace falta confirmación** antes de ejecutar órdenes de escritura (por ejemplo, un "sí/no" en la sala)?
15. **¿Cuántos usuarios remotos autorizados?** ¿Solo uno, o una lista?

## Arquitectura del plugin

16. ★ **¿En qué lenguaje lo escribimos?** Node (ejemplo oficial de Herdr), Python, o binario (Go/Rust). Mi recomendación: Node, por la documentación y el ejemplo disponibles; Matrix tiene bibliotecas maduras en JS y Python.
17. ★ **¿Cómo corre el proceso de larga duración (bridge)?** Opciones:
    - (a) Un `[[panes]]` visible (por ejemplo, un panel de log del bot).
    - (b) Un `[[keys.command]]` con `type = "shell"` (detached background).
    - (c) Un `[[startup]]` que lance un proceso desacoplado con `setsid`/`nohup`.
    
    Mi recomendación: (a) para la primera versión, por visibilidad y depuración, y migrar a (b) o (c) después.
18. **¿El plugin se instala desde GitHub** (con `herdr plugin install`) **o es local** (`herdr plugin link`)?
19. **¿Ya conocés el ejemplo `agent-telegram-notify`** del cookbook de Herdr? Es el ejemplo más parecido a este proyecto; si lo revisaste, decime qué te pareció.

## Entorno

20. **¿Qué versión de Herdr usás?** La doc consultada es de la 0.9.5 y el manifest pide `min_herdr_version`.
21. **¿Sistema operativo?** Resuelta: Linux y macOS (decidido 2026-10-26; `platforms` incluye `macos`). Validación en Mac pendiente, ver `docs/17-prueba-macos.md`. Windows no está previsto.
22. **¿Hay un repo git para este proyecto?** Ahora mismo el directorio no es un repo.

## Próximo paso propuesto

Antes de escribir código:

- Ejecutar `herdr api schema --json --output docs/herdr-schema.json` y guardar el resultado (fuente exacta de parámetros).
- Probar a mano login, `createRoom` y `send` contra el Synapse (con `curl`) y guardar los ejemplos reales en `docs/`.
- Revisar el ejemplo `agent-telegram-notify`.
