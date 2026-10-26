# herdr-matrix — Documentación de análisis

Objetivo: un **plugin de Herdr** que se conecte a un **servidor Matrix (Synapse)** para:

1. Enviar novedades de Herdr (agentes que terminan, se bloquean, piden atención) a una **sala Matrix**.
2. Permitir que un usuario remoto, desde el chat de la sala, dé **órdenes** a Herdr.
3. Al configurarse, pedir **URL y credenciales**, **crear la sala** y mostrarla para unirse, y/o pedir el **username Matrix** de la persona para invitarla.

## Índice

| Archivo | Contenido |
|---|---|
| [01-herdr-plugins.md](01-herdr-plugins.md) | Cómo funcionan los plugins de Herdr: manifest, entrypoints, variables de entorno, instalación, limitaciones. |
| [02-herdr-socket-api.md](02-herdr-socket-api.md) | API por socket y CLI: notificaciones, eventos, envío de texto y lectura de paneles, agentes. |
| [03-matrix-synapse.md](03-matrix-synapse.md) | Client-Server API de Matrix (login, crear sala, invitar, sync, enviar mensajes) y administración de Synapse. |
| [04-diseno-propuesto.md](04-diseno-propuesto.md) | Arquitectura propuesta, flujos, configuración y riesgos de seguridad. |
| [05-preguntas.md](05-preguntas.md) | Preguntas abiertas que hay que responder antes de implementar. |

## Fuentes consultadas

- Herdr — plugins: https://herdr.dev/docs/plugins/
- Herdr — socket API: https://herdr.dev/docs/socket-api/
- Herdr — configuración (notificaciones, sonidos, teclas): https://herdr.dev/docs/configuration/
- Herdr — índice de docs: https://herdr.dev/docs/
- Synapse — documentación: https://element-hq.github.io/synapse/latest/
- Synapse — instalación: https://element-hq.github.io/synapse/latest/setup/installation.html
- Synapse — Admin API (índice): https://element-hq.github.io/synapse/latest/usage/administration/admin_api/index.html
- Synapse — Admin API de usuarios: https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html
- Matrix — Client-Server API: https://spec.matrix.org/latest/client-server-api/ (la versión 1.19 es la que se pudo leer; el texto completo tiene ~480 KB y no se leyó entero)

## Estado de verificación

Cada dato está marcado en su archivo:

- **[confirmado]**: leído en la documentación fuente durante este análisis.
- **[verificar]**: conocimiento general del protocolo o de Synapse que no se pudo confirmar en la fuente consultada. Hay que validarlo contra la spec o contra un servidor real antes de implementar.
