// Chat directo con el agente de un espacio (0.11.0).
// Una sesión por sala de espacio. Los mensajes del dueño se encolan en orden y se envían al agente
// uno a uno (agent.prompt con espera). La respuesta se lee de la transcripción y se publica completa,
// en trozos si hace falta. La cola se guarda para no perder mensajes tras un reinicio.

import { spawn } from "node:child_process";
import { readOpencodeReply, readReply } from "./transcript.mjs";

export const AGENT_KINDS = ["claude", "opencode"];
// opencode run no tiene con quién confirmar permisos: --auto los aprueba, igual que el modo automático de Claude.
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode";
const OPENCODE_PROMPT_TIMEOUT_MS = 3 * 60_000;
const OPENCODE_POLL_MS = 2_000;
const OPENCODE_SETTLE_MS = 3_000;

// Argumentos de `opencode run`. `auto` aprueba los permisos sin preguntar (config: chat.opencode_auto).
export function opencodeArgs({ sessionId, text, auto }) {
  return [
    "run",
    "--format",
    "json",
    ...(auto ? ["--auto"] : []),
    ...(sessionId ? ["--session", sessionId] : []),
    text,
  ];
}

// Envía un mensaje a una sesión de opencode (la crea si no hay). Devuelve el ID de sesión.
// `opencode run` puede no terminar aunque la respuesta ya esté guardada: por eso, mientras corre,
// se mira la base y, cuando aparece la respuesta, se da la llamada por buena y se cierra el proceso.
// cwd: directorio del proyecto del workspace. opencode guarda sus sesiones por proyecto, así que
// ejecutarlo en otro directorio mezcla proyectos.
export function runOpencode({
  sessionId,
  text,
  cwd,
  auto = true,
  log = () => {},
  read = readOpencodeReply,
  timeoutMs = OPENCODE_PROMPT_TIMEOUT_MS,
  pollMs = OPENCODE_POLL_MS,
  settleMs = OPENCODE_SETTLE_MS,
}) {
  return new Promise((resolve, reject) => {
    if (!cwd) return reject(new Error("falta el directorio del proyecto para opencode"));
    const args = opencodeArgs({ sessionId, text, auto });
    const started = Date.now();
    log(`opencode run: inicio (sesión ${sessionId ?? "nueva"}, auto ${auto}, cwd ${cwd})`);
    const child = spawn(OPENCODE_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let known = sessionId ?? null;
    let buffered = "";
    let finished = false;
    let timer = null;
    let poll = null;

    function finish(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (child.exitCode === null) child.kill("SIGTERM");
      const seconds = Math.round((Date.now() - started) / 1000);
      if (error) {
        log(`opencode run: fallo tras ${seconds} s: ${error.message.slice(0, 200)}`);
        reject(error);
      } else {
        log(`opencode run: fin tras ${seconds} s`);
        resolve(value);
      }
    }

    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      for (const line of buffered.split("\n")) {
        try {
          const event = JSON.parse(line);
          if (!known && event.sessionID) known = event.sessionID;
        } catch {
          // Las líneas parciales o no JSON no aportan el ID de sesión.
        }
      }
      buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
    });
    child.stderr.resume();
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (known) finish(null, known);
      else finish(new Error(`opencode terminó con código ${code} sin ID de sesión`));
    });

    timer = setTimeout(() => finish(new Error("opencode no respondió a tiempo")), timeoutMs);
    poll = setInterval(async () => {
      if (!known || finished) return;
      const reply = await read({ sessionId: known, sentText: text }).catch(() => null);
      if (reply) {
        // Pequeña espera para que la respuesta esté completa antes de cerrar el proceso.
        setTimeout(() => finish(null, known), settleMs);
        clearInterval(poll);
      }
    }, pollMs);
  });
}

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
  runAgentOpencode = runOpencode,
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

  // Envía un texto al agente y espera a que termine. Devuelve el ID de sesión del agente.
  async function promptAgent(text) {
    if (session.agentKind === "opencode") {
      session.sessionId = await runAgentOpencode({
        sessionId: session.sessionId, text, cwd: session.cwd, auto: opencodeAuto, log,
      });
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
      await save();
      return;
    }
    const { agents } = await herdr.request("agent.list", {});
    const agent = agentOfWorkspace(agents, workspaceId);
    if (agent) {
      session.paneId = agent.pane_id;
    } else {
      // Sin agente en el workspace: se arranca uno en su panel principal.
      session.paneId = `${workspaceId}:p1`;
      await herdr.request("agent.start", { name: `chat-${workspaceId}`, kind, pane_id: session.paneId, timeout_ms: 60_000 });
    }
    await waitUntilReady();
    await promptAgent(FORMAT_INSTRUCTION);
    await save();
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

  // Procesa la cola en orden. Un mensaje se quita solo cuando su respuesta se ha publicado.
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (session.queue.length && !session.awaitingResume) {
        const item = session.queue[0];
        let reply = null;
        try {
          await promptAgent(item.text);
          reply = await replyFor(item.text);
        } catch (error) {
          log(`envío al agente fallido: ${error.message}`);
          await say(`no se pudo enviar el mensaje al agente: ${error.message.slice(0, 200)}`);
          session.queue.shift();
          await save();
          continue;
        }
        await say(reply ?? "no pude leer la respuesta del agente (el agente sigue trabajando o no hay transcripción).");
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
    snapshot,
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

    open,
    say,
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
    all,
    pending() {
      return [...sessions.values()].filter((session) => session.queued > 0);
    },
  };
}
