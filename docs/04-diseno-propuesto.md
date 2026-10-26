# Diseño propuesto

Estado: **propuesta para discutir**. Depende de las respuestas en `05-preguntas.md`.

## Componentes

```
┌──────────────────────── Herdr ────────────────────────┐
│  agentes / paneles / workspaces                        │
│        │  eventos (events.subscribe)                   │
│        ▼                                               │
│  plugin herdr-matrix  ───────────────────────────────┐ │
│   ├─ bridge (proceso de larga duración)              │ │
│   │    · lee eventos de Herdr                        │ │
│   │    · publica novedades en la sala                │ │
│   │    · escucha la sala y despacha órdenes          │ │
│   └─ setup (acción: pide URL/credenciales, crea sala)│ │
└──────────────────────────────────────────────────────┘ │
                 │ HTTP (Client-Server API)              │
                 ▼                                       │
        Synapse (homeserver) ◄──── usuario remoto (cliente Matrix)
```

- **bridge**: proceso que mantiene el sync con Matrix y la suscripción a eventos de Herdr. Es el único que necesita correr todo el tiempo.
- **setup**: flujo interactivo de configuración. Se ejecuta como `[[actions]]` o desde un `[[panes]]`.

## Estructura del repo propuesta

```
herdr-matrix/
  herdr-plugin.toml        manifest
  src/
    bridge.*               proceso de larga duración
    setup.*                flujo de configuración interactivo
    matrix.*               cliente Matrix mínimo (login, createRoom, invite, sync, send)
    herdr.*                cliente socket de Herdr (subscribe, notification.show, agent.*)
    commands.*             parser y allowlist de órdenes
  docs/                    esta documentación
```

Lenguaje: no decidido (ver preguntas). Si se elige Node o Python, la doc de Herdr funciona con cualquiera.

## Flujos

### A. Configuración (primera vez)

1. Usuario ejecuta la acción `setup` (`herdr plugin action invoke herdr-matrix.setup`).
2. Pide **URL** del servidor (`https://hs.example.org`), **usuario** y **contraseña** del bot.
3. Llama a `POST /login`, guarda `access_token` en `HERDR_PLUGIN_STATE_DIR` (0600). Descarta la contraseña.
4. Llama a `whoami` para validar.
5. Crea la sala con `createRoom` (`preset`, `name`).
6. Muestra el `room_id` o el alias, y propone:
   - **Opción A**: "únase con este enlace/alias" (la persona entra con `/join`).
   - **Opción B**: "¿cuál es tu username Matrix?" → `invite` con `@usuario:servidor`.
7. Guarda la configuración en `HERDR_PLUGIN_CONFIG_DIR/config.toml` (sin contraseña).

### B. Novedades de Herdr → sala

1. El bridge se suscribe por socket a `pane.agent_status_changed`, `pane.exited`, `pane.output_matched` (según lo que se elija).
2. Filtra solo lo relevante (p. ej., agente pasa a `blocked` o `done`).
3. Publica `m.room.message` en la sala con un texto corto: workspace, panel, estado, fragmento de salida.
4. Opcionalmente, también `notification.show` local.

### C. Órdenes de la sala → Herdr

1. El bridge hace `sync` y recibe `m.room.message` de la sala.
2. Verifica `sender` contra la lista de usuarios autorizados. Si no está, ignora (y opcionalmente responde).
3. Parsea el comando con una **allowlist fija**. Ejemplo:

   | Orden en el chat | Llamada a Herdr |
   |---|---|
   | `estado` | `agent.list` |
   | `leer <pane>` | `pane.read` (últimas N líneas) |
   | `enviar <pane> <texto>` | `agent.prompt` o `pane.send_text` |
   | `enter <pane>` | `pane.send_keys` con `enter` |

4. Responde en la sala con el resultado.

## Seguridad (obligatorio)

Herdr no tiene sandbox y un plugin corre como el usuario con acceso total a la CLI. Una orden remota mal filtrada equivale a **ejecución remota de comandos en la máquina**.

- **Allowlist de remitentes** (`@usuario:servidor`) en la configuración. Nada de "cualquiera de la sala".
- **Allowlist de órdenes**: no reenviar texto libre a un shell. Solo acciones predefinidas.
- **Sala privada** y sin federación si es posible.
- **Token fuera del repo**, permisos `0600`, nunca en `HERDR_PLUGIN_ROOT`.
- **Confirmación** para acciones destructivas o de escritura (opcional, a definir).
- **Registro** de cada orden recibida y de quién la envió (`HERDR_PLUGIN_STATE_DIR/log`).

## Riesgos técnicos

- Startup hooks no sirven como daemon (ver `01-herdr-plugins.md`). Hay que decidir cómo corre el bridge.
- Los eventos pueden perderse (`events_lost`). Hay que reconciliar con `session.snapshot`.
- Si un panel referenciado desaparece, la suscripción falla completa. Hay que resuscribir con los paneles vigentes.
- Matrix long-poll: manejar reconexiones y `next_batch` persistido.
- Sin E2EE, los mensajes viajan en claro dentro del servidor (sí cifrados en tránsito si hay TLS).

## Fases sugeridas

1. **Fase 0** — Probar a mano: login, `createRoom`, `send`, y `herdr api schema` / suscripción de prueba. Guardar la salida en `docs/`.
2. **Fase 1** — Plugin mínimo: acción `setup` (URL, credenciales, crear sala, mostrar `room_id`).
3. **Fase 2** — Bridge de salida: eventos de Herdr → sala.
4. **Fase 3** — Bridge de entrada: sala → órdenes con allowlist.
5. **Fase 4** — Invitación por username, reconexión, logs, tests.
