// Entrada: órdenes de la sala a Herdr (Fase 3).
// Orden de comprobaciones (cualquier fallo en 1–3 se ignora sin responder):
//   1. la sala es la de control o una sala activa de workspace, y está cifrada;
//   2. el remitente es el dueño y es miembro `join` de la sala;
//   3. el mensaje es reciente (≤ 60 s) y no es del propio bot;
//   4. el verbo está en la tabla y los argumentos son válidos;
//   5. alcance: la sala de control solo lee; la escritura va en la sala del espacio;
//   6. escritura: pide confirmación `confirmar` en 60 s; una acción pendiente por remitente.
// Cada orden que llega a 4 queda en la auditoría. El texto de `enviar` no se registra.

import { COMMANDS, foldWord, isConfirmation, normalizeBody, paneWorkspace, parseCommand } from "./commands.mjs";
import { AGENT_KINDS } from "./chat.mjs";

// En la auditoría de órdenes no reconocidas solo va la primera palabra: nunca el resto del mensaje.
const WORD_AUDIT_MAX = 20;

export const MAX_AGE_MS = 60_000;
export const CONFIRM_TIMEOUT_MS = 60_000;
export const RATE_LIMIT = { max: 10, windowMs: 60_000 };
const AGENT_LINES = 20;
const READ_LINES = 20;
const READ_MAX_CHARS = 1500;
const MAX_SEEN_EVENTS = 1000;

// Sustituye los caracteres de control de la salida de un panel; conserva los saltos de línea.
function cleanOutput(text) {
  return String(text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(-READ_MAX_CHARS);
}

function herdrParams(verb, args) {
  if (verb === "estado") return {};
  if (verb === "leer") return { pane_id: args.pane, source: "recent", lines: READ_LINES, format: "text", strip_ansi: true };
  if (verb === "enviar") return { pane_id: args.pane, text: args.text };
  if (verb === "enter") return { pane_id: args.pane, keys: COMMANDS.enter.keys };
  throw new Error(`verbo sin parámetros ${verb}`);
}

export function createInbound({
  herdr,
  sender,
  config,
  botUserId,
  isEncrypted,
  membership,
  audit,
  log,
  invites = null,
  chats = null,
  now = () => Date.now(),
}) {
  const pending = new Map(); // remitente → { verb, args, roomId, expiresAt }
  const orders = new Map(); // remitente → marcas de tiempo de órdenes recientes
  const seen = new Set();
  let queue = Promise.resolve();

  // Nombre del espacio para las respuestas: su etiqueta en la configuración, o el ID si no la tiene.
  function labelOf(workspaceId) {
    return (config.rooms ?? []).find((room) => room.workspace_id === workspaceId)?.label ?? workspaceId;
  }

  function scopeOf(roomId) {
    if (roomId === config.control_room_id) return { control: true };
    const room = (config.rooms ?? []).find((item) => item.room_id === roomId && item.status === "active");
    return room ? { control: false, workspaceId: room.workspace_id } : null;
  }

  function withinRateLimit(from) {
    const cutoff = now() - RATE_LIMIT.windowMs;
    const recent = (orders.get(from) ?? []).filter((at) => at > cutoff);
    const allowed = recent.length < RATE_LIMIT.max;
    if (allowed) recent.push(now());
    orders.set(from, recent);
    return allowed;
  }

  async function reply(roomId, text) {
    try {
      await sender.sendText(roomId, text);
    } catch (error) {
      log(`respuesta no enviada: ${error.message}`);
    }
  }

  async function record(entry) {
    await audit.record(entry);
  }

  // `chat` abre claude; `chat opencode` abre opencode. Devuelve el agente pedido o null.
  function chatRequest(body) {
    const words = foldWord(normalizeBody(body)).split(/\s+/);
    if (words[0] !== "chat" || words.length > 2) return null;
    const kind = words[1] ?? "claude";
    return AGENT_KINDS.includes(kind) ? kind : null;
  }

  // Abre la sesión de chat sin bloquear la cola de órdenes: la respuesta llega cuando el agente está listo.
  function startChat(roomId, kind = "claude") {
    const scope = scopeOf(roomId);
    const session = chats.create({ roomId, workspaceId: scope.workspaceId, paneId: `${scope.workspaceId}:p1` });
    session
      .open(kind)
      .then(() => reply(roomId, `sesión de chat abierta con ${kind} en ${labelOf(scope.workspaceId)}. Escribe salir para cerrarla.`))
      .catch(async (error) => {
        log(`sesión de chat no abierta en ${scope.workspaceId}: ${error.message}`);
        await chats.close(roomId);
        await reply(roomId, `no se pudo abrir la sesión de chat: ${error.message}`);
      });
    return "abriendo la sesión de chat…";
  }

  async function execute(roomId, verb, args) {
    if (verb === "chat") return startChat(roomId, args.kind);
    if (verb === "estado") {
      const { agents } = await herdr.request("agent.list", {});
      const scope = scopeOf(roomId);
      const visible = scope.control ? agents : agents.filter((agent) => agent.workspace_id === scope.workspaceId);
      if (!visible.length) return "no hay agentes en este alcance.";
      const lines = visible.slice(0, AGENT_LINES).map((agent) =>
        `[${labelOf(agent.workspace_id)} · ${agent.pane_id}] ${agent.agent_status}: ${agent.agent ?? "agente"}`);
      if (visible.length > AGENT_LINES) lines.push(`… y ${visible.length - AGENT_LINES} más`);
      return lines.join("\n");
    }
    if (verb === "leer") {
      const result = await herdr.request(COMMANDS.leer.method, herdrParams(verb, args));
      return cleanOutput(result.read?.text) || "(panel vacío)";
    }
    await herdr.request(COMMANDS[verb].method, herdrParams(verb, args));
    return verb === "enviar" ? "texto enviado al panel." : "tecla enviada al panel.";
  }

  async function handleOrder({ roomId, sender: from, body }, scope) {
    const parsed = parseCommand(body);
    if (parsed.error) {
      await reply(roomId, parsed.error);
      const word = parsed.word ? ` (primera palabra: "${parsed.word.slice(0, WORD_AUDIT_MAX)}")` : "";
      await record({ sender: from, room: roomId, verb: "-", pane: "-", result: `rechazada: ${parsed.error}${word}` });
      return;
    }
    const { verb, args } = parsed;
    const pane = args.pane ?? "-";

    if (!withinRateLimit(from)) {
      await reply(roomId, "demasiadas órdenes en poco tiempo; espera un minuto.");
      await record({ sender: from, room: roomId, verb, pane, result: "rechazada: límite de frecuencia" });
      return;
    }

    if (args.pane && !scope.control && paneWorkspace(args.pane) !== scope.workspaceId) {
      await reply(roomId, "ese panel no pertenece a este espacio.");
      await record({ sender: from, room: roomId, verb, pane, result: "rechazada: panel fuera del espacio" });
      return;
    }
    if (COMMANDS[verb].write && scope.control) {
      await reply(roomId, "las órdenes de escritura se envían desde la sala del espacio del panel.");
      await record({ sender: from, room: roomId, verb, pane, result: "rechazada: escritura en sala de control" });
      return;
    }

    if (COMMANDS[verb].write) {
      pending.set(from, { verb, args, roomId, expiresAt: now() + CONFIRM_TIMEOUT_MS });
      await reply(roomId, `¿confirmas la orden ${verb} en ${labelOf(paneWorkspace(pane))} (${pane})? Responde confirmar en 60 s. Cualquier otro mensaje la cancela.`);
      await record({ sender: from, room: roomId, verb, pane, result: "pendiente de confirmación" });
      return;
    }

    try {
      const text = await execute(roomId, verb, args);
      await reply(roomId, text);
      await record({ sender: from, room: roomId, verb, pane, result: "ok" });
    } catch (error) {
      await reply(roomId, "no se pudo ejecutar la orden.");
      await record({ sender: from, room: roomId, verb, pane, result: `error: ${error.message}` });
    }
  }

  async function handleConfirmation({ roomId, sender: from }) {
    const action = pending.get(from);
    pending.delete(from);
    if (!action || action.roomId !== roomId || now() > action.expiresAt) {
      await reply(roomId, "no hay ninguna orden pendiente de confirmar o ha caducado.");
      await record({ sender: from, room: roomId, verb: "confirmar", pane: "-", result: "sin pendiente o caducada" });
      return;
    }
    try {
      const text = await execute(roomId, action.verb, action.args);
      await reply(roomId, text);
      await record({ sender: from, room: roomId, verb: action.verb, pane: action.args.pane, result: "ok (confirmada)" });
    } catch (error) {
      await reply(roomId, "no se pudo ejecutar la orden.");
      await record({ sender: from, room: roomId, verb: action.verb, pane: action.args.pane, result: `error: ${error.message}` });
    }
  }

  async function processEvent({ roomId, sender: from, body, ts }) {
    if (from === botUserId) return;
    if (now() - ts > MAX_AGE_MS) return;
    const scope = scopeOf(roomId);
    if (!scope) return;
    if (!(await isEncrypted(roomId))) return;

    if (from !== config.owner || membership(roomId, from) !== "join") {
      await record({ sender: from, room: roomId, verb: "-", pane: "-", result: "no autorizado" });
      return;
    }

    // Respuesta a una pregunta de invitación (solo en la sala de control). Si no contesta a la pregunta, sigue como orden.
    if (scope.control && invites) {
      const answer = await invites.handle(body);
      if (answer !== null) {
        await reply(roomId, answer);
        await record({ sender: from, room: roomId, verb: "invitación", pane: "-", result: "respuesta a pregunta de invitación" });
        return;
      }
    }

    // Sesión de chat abierta en esta sala: todo va al agente, salvo `salir` y la reanudación tras reiniciar.
    if (!scope.control && chats?.has(roomId)) {
      const session = chats.get(roomId);
      const word = foldWord(normalizeBody(body));
      if (word === "salir") {
        await chats.close(roomId);
        await reply(roomId, "sesión de chat cerrada; el agente sigue abierto.");
        await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: "sesión cerrada" });
        return;
      }
      if (session.awaitingResume && (word === "confirmar" || word === "descartar")) {
        if (word === "confirmar") {
          await reply(roomId, `reanudo ${session.queued} mensaje(s) pendiente(s).`);
          session.resume().catch((error) => log(`reanudación fallida: ${error.message}`));
        } else {
          await session.discard();
          await reply(roomId, "mensajes pendientes descartados.");
        }
        await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: `pendientes: ${word}` });
        return;
      }
      session.enqueue(body).catch((error) => log(`mensaje de chat fallido: ${error.message}`));
      await reply(roomId, `recibido; en cola: ${session.queued}`);
      await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: "en cola" });
      return;
    }

    if (isConfirmation(body)) {
      await handleConfirmation({ roomId, sender: from });
      return;
    }
    if (pending.has(from)) {
      const cancelled = pending.get(from);
      pending.delete(from);
      await record({ sender: from, room: roomId, verb: cancelled.verb, pane: cancelled.args.pane, result: "cancelada por otro mensaje" });
      await reply(roomId, "la orden pendiente se ha cancelado.");
    }
    if (chats && foldWord(normalizeBody(body)) === "salir") {
      await reply(roomId, "no hay ninguna sesión de chat abierta en este espacio.");
      await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: "salir sin sesión" });
      return;
    }
    const chatKind = chatRequest(body);
    if (chats && chatKind) {
      if (scope.control) {
        await reply(roomId, "la sesión de chat se abre desde la sala del espacio.");
        await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: "rechazada: chat en sala de control" });
        return;
      }
      pending.set(from, { verb: "chat", args: { kind: chatKind }, roomId, expiresAt: now() + CONFIRM_TIMEOUT_MS });
      await reply(roomId, `¿abrir una sesión de chat con ${chatKind} en ${labelOf(scope.workspaceId)}? Los mensajes irán al agente hasta que escribas salir. Responde confirmar en 60 s.`);
      await record({ sender: from, room: roomId, verb: "chat", pane: "-", result: "pendiente de confirmación" });
      return;
    }
    await handleOrder({ roomId, sender: from, body }, scope);
  }

  // Las órdenes se procesan una a una: confirmar y cancelar no pueden cruzarse.
  return {
    handle(event) {
      if (seen.has(event.eventId)) return queue;
      seen.add(event.eventId);
      if (seen.size > MAX_SEEN_EVENTS) seen.delete(seen.values().next().value);
      queue = queue.then(() => processEvent(event)).catch((error) => log(`orden ignorada por error: ${error.message}`));
      return queue;
    },
  };
}
