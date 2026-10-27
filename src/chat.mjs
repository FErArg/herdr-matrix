// Chat directo con el agente de un espacio (0.11.0).
// Una sesión por sala de espacio. Los mensajes del dueño se encolan en orden y se envían al agente
// uno a uno (agent.prompt con espera). La respuesta se lee de la transcripción y se publica completa,
// en trozos si hace falta. La cola se guarda para no perder mensajes tras un reinicio.

import { readReply, readTurn } from "./transcript.mjs";
import { describePermission, interruptOpencode, readOpencodeApiTurn, readOpencodeReply, replyOpencodePermission, runOpencode } from "./opencode-api.mjs";

export const AGENT_KINDS = ["claude", "opencode"];
export const FORMAT_INSTRUCTION =
  "A partir de ahora, responde en texto plano y breve, apto para leerse en un mensaje de chat. No uses tablas ni bloques de código salvo que te lo pidan.";
export const CHUNK_MAX = 3500;
const PROMPT_TIMEOUT_MS = 15 * 60_000;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 2_000;

// Parte un texto en trozos de como mucho `max` caracteres, cortando entre líneas cuando se puede.
export function chunkText(text, max = CHUNK_MAX) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    const piece = line.length > max ? line.slice(0, max) : line;
    if (current && (current + "\n" + piece).length > max) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Agente del workspace: el único que puede responder en su sala. Los agentes de otros workspaces se ignoran.
// Un workspace tiene un agente; más de uno es un estado ambiguo y no se elige ninguno.
export function agentOfWorkspace(agents, workspaceId) {
  const own = agents.filter((agent) => agent.workspace_id === workspaceId);
  if (own.length > 1) throw new Error("hay más de un agente en el workspace");
  return own[0] ?? null;
}

// El agente del panel no es el de la sesión (o no se puede identificar). La sesión se pausa; nada se envía.
export class AgentChangedError extends Error {}

// Sesión de chat de un espacio. Dependencias inyectadas: herdr (request), sendText(roomId, text),
// leer transcripción (readReply), persistencia y reloj.

export function createChatSession({
  herdr,
  sendText,
  roomId,
  workspaceId,
  paneId,
  persist,
  log,
  now = () => Date.now(),
  read = readReply,
  readOpencode = readOpencodeReply,
  readOpencodeCard = readOpencodeApiTurn,
  runAgentOpencode = runOpencode,
  replyAgentPermission = replyOpencodePermission,
  interruptAgent = interruptOpencode,
  opencodeAuto = true,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  state = {},
}) {
  const session = {
    roomId,
    workspaceId,
    paneId,
    sessionId: state.sessionId ?? null,
    cwd: state.cwd ?? null,
    agentKind: state.agentKind ?? "claude",
    queue: state.queue ?? [], // { text, at }
    awaitingResume: Boolean(state.awaitingResume),
  };
  let running = false;
  // Permiso de opencode pendiente de decisión. No se guarda: si el bridge se reinicia, el turno ya no existe.
  let pendingPermission = null;

  // El dueño decide el permiso pendiente. Devuelve false si no hay ninguno.
  async function decidePermission(decision) {
    if (!pendingPermission) return false;
    const { sessionId, requestId } = pendingPermission;
    pendingPermission = null;
    await replyAgentPermission({ sessionId, requestId, decision });
    return true;
  }

  // Interrumpe el turno de opencode. Con otro agente no hace nada y devuelve false.
  async function interrupt() {
    if (session.agentKind !== "opencode" || !session.sessionId) return false;
    pendingPermission = null;
    await interruptAgent({ sessionId: session.sessionId });
    return true;
  }

  const save = () => persist(snapshot());
  const snapshot = () => ({
    roomId: session.roomId,
    workspaceId: session.workspaceId,
    paneId: session.paneId,
    sessionId: session.sessionId,
    cwd: session.cwd,
    agentKind: session.agentKind,
    queue: session.queue,
    awaitingResume: session.awaitingResume,
  });

  async function say(text) {
    for (const chunk of chunkText(text)) {
      try {
        await sendText(roomId, chunk);
      } catch (error) {
        log(`respuesta del chat no enviada: ${error.message}`);
      }
    }
  }

  // Antes de cada envío, el agente del panel se lee de Herdr: si ya no es del tipo de la sesión, nada sale.
  async function checkAgentKind() {
    const { agents } = await herdr.request("agent.list", {});
    let agent;
    try {
      agent = agentOfWorkspace(agents, workspaceId);
    } catch (error) {
      throw new AgentChangedError(`${error.message}; la sesión queda en pausa.`);
    }
    if (!agent?.agent) {
      throw new AgentChangedError("no se identifica el agente del workspace; la sesión queda en pausa.");
    }
    if (agent.agent !== session.agentKind) {
      throw new AgentChangedError(`el agente del workspace ahora es ${agent.agent}, no ${session.agentKind}; la sesión queda en pausa.`);
    }
    session.paneId = agent.pane_id;
    // opencode: la sesión que muestra el panel es la que debe recibir el mensaje, para que la TUI lo vea.
    if (session.agentKind === "opencode" && agent.agent_session?.value) session.sessionId = agent.agent_session.value;
  }

  // Permiso pedido por opencode con `chat.opencode_auto` desactivado: la sala avisa y el dueño decide.
  function askPermission(request) {
    pendingPermission = { sessionId: session.sessionId, requestId: request.id };
    say(`opencode pide permiso: ${describePermission(request)}. Responde permitir (una vez) o rechazar.`);
  }

  // Envía un texto al agente y espera a que termine. Devuelve el ID de sesión del agente.
  async function promptAgent(text) {
    await checkAgentKind();
    if (session.agentKind === "opencode") {
      try {
        session.sessionId = await runAgentOpencode({
          sessionId: session.sessionId, text, cwd: session.cwd, auto: opencodeAuto, log,
          onPermission: (request) => askPermission(request),
        });
      } finally {
        pendingPermission = null;
      }
      return {};
    }
    // El cliente espera más que la espera del agente; si no, corta antes y Herdr registra client_disconnected.
    const result = await herdr.request("agent.prompt", {
      target: session.paneId,
      text,
      wait: { until: ["idle", "done"], timeout_ms: PROMPT_TIMEOUT_MS },
    }, PROMPT_TIMEOUT_MS + 30_000);
    const sessionId = result.agent?.agent_session?.value ?? null;
    if (sessionId) session.sessionId = sessionId;
    if (result.agent?.cwd) session.cwd = result.agent.cwd;
    return result;
  }

  // Espera a que el agente del panel acepte entrada. Un agente recién arrancado no la acepta de inmediato.
  async function waitUntilReady(timeoutMs = READY_TIMEOUT_MS) {
    const deadline = now() + timeoutMs;
    for (;;) {
      const { agents } = await herdr.request("agent.list", {});
      const agent = agents.find((item) => item.pane_id === session.paneId);
      if (agent?.interactive_ready) return agent;
      if (now() > deadline) throw new Error("el agente no quedó listo a tiempo");
      await sleep(READY_POLL_MS);
    }
  }

  // Abre la sesión: arranca el agente si el panel no tiene uno, espera a que esté listo y pide el formato breve.
  async function open(kind = "claude") {
    if (!AGENT_KINDS.includes(kind)) throw new Error(`agente no soportado: ${kind}`);
    // Un ID de sesión solo vale para el tipo de agente que lo creó: al cambiar de tipo se olvida.
    if (session.agentKind !== kind) {
      session.sessionId = null;
      session.cwd = null;
    }
    session.agentKind = kind;
    if (kind === "opencode") {
      // opencode no necesita instrucción de formato: la sesión se crea con el primer mensaje, en el
      // directorio del panel del workspace (no en el del bridge).
      // La instrucción de formato hacía que el modelo respondiera con basura de herramientas.
      const { agents } = await herdr.request("agent.list", {});
      const agent = agentOfWorkspace(agents, workspaceId);
      if (agent?.agent !== "opencode" || !agent.cwd) throw new Error("no hay opencode detectado en el workspace");
      session.paneId = agent.pane_id;
      session.cwd = agent.cwd;
      // La sesión de la TUI: el chat escribe en la misma conversación que ve el dueño en el panel.
      session.sessionId = agent.agent_session?.value ?? session.sessionId;
      await save();
      return;
    }
    const { agents } = await herdr.request("agent.list", {});
    const agent = agentOfWorkspace(agents, workspaceId);
    if (agent) {
      // Un agente de otro tipo en el panel haría que la respuesta se busque en una transcripción que no existe.
      if (agent.agent !== kind) throw new Error(`el agente del workspace es ${agent.agent}, no ${kind}`);
      // Un agente ocupado no tumba la sesión: el formato va en la cola y se envía cuando esté libre.
      session.paneId = agent.pane_id;
    } else {
      // Sin agente en el workspace: se arranca uno en su panel principal y se espera a que esté listo.
      session.paneId = `${workspaceId}:p1`;
      await herdr.request("agent.start", { name: `chat-${workspaceId}`, kind, pane_id: session.paneId, timeout_ms: 60_000 });
      await waitUntilReady();
    }
    session.queue.unshift({ text: FORMAT_INSTRUCTION, at: now(), internal: true });
    await save();
    drain();
  }

  // Respuesta del último mensaje, leída de la transcripción del agente que se abrió.
  async function replyFor(sentText) {
    if (!session.sessionId) return null;
    if (session.agentKind === "opencode") {
      return readOpencode({ sessionId: session.sessionId, sentText });
    }
    if (!session.cwd) return null;
    return read({ cwd: session.cwd, sessionId: session.sessionId, sentText });
  }

  // Turno actual del agente (pedido, respuesta, cambios, errores), para la tarjeta. Null si no se puede leer.
  async function turn() {
    if (!session.sessionId) return null;
    if (session.agentKind === "opencode") {
      return readOpencodeCard({ sessionId: session.sessionId });
    }
    if (!session.cwd) return null;
    return readTurn({ cwd: session.cwd, sessionId: session.sessionId });
  }

  // Procesa la cola en orden. Un mensaje se quita solo cuando su respuesta se ha publicado.
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (session.queue.length && !session.awaitingResume) {
        const item = session.queue[0];
        try {
          await promptAgent(item.text);
        } catch (error) {
          if (error instanceof AgentChangedError) {
            // La cola se conserva; solo `salir` la descarta. `confirmar` la reintenta, y vuelve a comprobar el agente.
            log(`sesión pausada: ${error.message}`);
            session.awaitingResume = true;
            await save();
            await say(`sesión en pausa: ${error.message}`);
            return;
          }
          log(`envío al agente fallido: ${error.message}`);
          await say(`no se pudo enviar el mensaje al agente: ${error.message.slice(0, 200)}`);
          session.queue.shift();
          await save();
          continue;
        }
        // El mensaje ya llegó al agente: un fallo al leer la respuesta no es un fallo de envío.
        let reply = null;
        try {
          reply = await replyFor(item.text);
        } catch (error) {
          log(`lectura de la respuesta fallida: ${error.message}`);
        }
        // La instrucción de formato es interna: no se publica su respuesta.
        if (!item.internal) await say(reply ?? "no pude leer la respuesta del agente (el agente sigue trabajando o no hay transcripción).");
        session.queue.shift();
        await save();
      }
    } catch (error) {
      log(`sesión de chat interrumpida: ${error.message}`);
    } finally {
      running = false;
    }
  }

  return {
    roomId,
    workspaceId,
    snapshot,
    turn,
    get queued() {
      return session.queue.length;
    },
    get awaitingResume() {
      return session.awaitingResume;
    },

    async enqueue(text) {
      session.queue.push({ text, at: now() });
      await save();
      await drain();
      return session.queue.length;
    },

    // Tras reiniciar el bridge, la cola queda en pausa hasta que el dueño confirme.
    pauseForResume() {
      if (session.queue.length) session.awaitingResume = true;
    },

    async resume() {
      session.awaitingResume = false;
      await save();
      await drain();
    },

    async discard() {
      session.queue = [];
      session.awaitingResume = false;
      await save();
    },

    oldestAgeMinutes() {
      if (!session.queue.length) return 0;
      return Math.round((now() - session.queue[0].at) / 60_000);
    },

    get hasPendingPermission() {
      return pendingPermission !== null;
    },

    open,
    say,
    decidePermission,
    interrupt,
  };
}

// Gestor de sesiones: una por sala de espacio, persistidas en un único fichero.
export function createChatManager({ herdr, sendText, persistAll, restore = [], log, now, opencodeAuto = true }) {
  const sessions = new Map();
  for (const state of restore) {
    if (state?.roomId) {
      sessions.set(state.roomId, createChatSession({
        herdr, sendText, log, now, opencodeAuto,
        roomId: state.roomId,
        workspaceId: state.workspaceId,
        paneId: state.paneId,
        state,
        persist: () => persistAll(all()),
      }));
    }
  }

  function all() {
    return [...sessions.values()].map((session) => session.snapshot());
  }

  return {
    get(roomId) {
      return sessions.get(roomId) ?? null;
    },
    has(roomId) {
      return sessions.has(roomId);
    },
    create({ roomId, workspaceId, paneId }) {
      const session = createChatSession({
        herdr, sendText, log, now, opencodeAuto,
        roomId, workspaceId, paneId,
        persist: () => persistAll(all()),
      });
      sessions.set(roomId, session);
      return session;
    },
    async close(roomId) {
      sessions.delete(roomId);
      await persistAll(all());
    },
    // Sesión abierta en ese workspace, o null. Nunca se devuelve la de otro workspace.
    findByWorkspace(workspaceId) {
      return [...sessions.values()].find((item) => item.workspaceId === workspaceId) ?? null;
    },
    all,
    pending() {
      return [...sessions.values()].filter((session) => session.queued > 0);
    },
  };
}
