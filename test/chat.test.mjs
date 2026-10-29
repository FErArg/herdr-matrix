import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, createChatManager, createChatSession, FORMAT_INSTRUCTION } from "../src/chat.mjs";
import { replyAfter, transcriptPath } from "../src/transcript.mjs";
import { createInbound } from "../src/inbound.mjs";

const OWNER = "@owner:hs.example.org";
const BOT = "@bot-test:hs.example.org";
const CONTROL = "!control";
const ROOM = "!api";

const jsonl = (...entries) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const userText = (text) => ({ type: "user", message: { role: "user", content: text } });
const assistantText = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const toolResult = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "salida" }] } });

test("replyAfter devuelve el texto del asistente tras el mensaje enviado", () => {
  const log = jsonl(userText("hola"), assistantText("respuesta vieja"), userText("cuánto es 2+2"), toolResult(), assistantText("4"));
  assert.equal(replyAfter(log, "cuánto es 2+2"), "4");
});

test("replyAfter concatena varios bloques del asistente y no corta en resultados de herramientas", () => {
  const log = jsonl(userText("lista"), assistantText("primera parte"), toolResult(), assistantText("segunda parte"));
  assert.equal(replyAfter(log, "lista"), "primera parte\n\nsegunda parte");
});

test("replyAfter devuelve null si el mensaje no está en la transcripción", () => {
  assert.equal(replyAfter(jsonl(userText("otro"), assistantText("x")), "no está"), null);
});

test("transcriptPath cambia cada carácter que no sea letra o dígito del directorio de trabajo por guiones", () => {
  assert.equal(
    transcriptPath("/home/owner/Git/projects/herdr-matrix", "abc", "/home/owner"),
    "/home/owner/.claude/projects/-home-owner-Git-projects-herdr-matrix/abc.jsonl",
  );
  assert.equal(
    transcriptPath("/var/folders/ab/123_4c/T/hm-agente.Xyz", "abc", "/h"),
    "/h/.claude/projects/-var-folders-ab-123-4c-T-hm-agente-Xyz/abc.jsonl",
  );
});

test("chunkText parte por líneas y no supera el máximo", () => {
  const text = Array.from({ length: 30 }, (_, i) => `línea ${i} ${"x".repeat(20)}`).join("\n");
  const chunks = chunkText(text, 200);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 200));
  assert.equal(chunks.join("\n"), text);
});

function fakeChat({ replies = {}, state } = {}) {
  const prompts = [];
  const sent = [];
  let saved = null;
  const herdr = {
    request: async (method, params) => {
      if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: state?.agentKind ?? "claude" }] };
      if (method === "agent.start") return { type: "agent_started" };
      if (method === "agent.prompt") {
        prompts.push(params.text);
        return { agent: { agent_session: { value: "sess-1" }, cwd: "/repo" } };
      }
      throw new Error(`método no simulado ${method}`);
    },
  };
  const session = createChatSession({
    herdr,
    sendText: async (roomId, text) => sent.push({ roomId, text }),
    roomId: ROOM,
    workspaceId: "w1",
    paneId: "w1:p1",
    persist: async (data) => { saved = data; },
    log: () => {},
    read: async ({ sentText }) => replies[sentText] ?? null,
    state,
  });
  return { session, prompts, sent, saved: () => saved };
}

test("las órdenes de chat se envían en orden y cada respuesta se publica", async () => {
  const { session, prompts, sent } = fakeChat({ replies: { uno: "respuesta 1", dos: "respuesta 2" } });
  await session.enqueue("uno");
  await session.enqueue("dos");
  assert.deepEqual(prompts, ["uno", "dos"]);
  assert.deepEqual(sent.map((m) => m.text), ["respuesta 1", "respuesta 2"]);
  assert.equal(session.queued, 0);
});

test("si no se puede leer la respuesta, se avisa y la cola avanza", async () => {
  const { session, sent } = fakeChat({ replies: {} });
  await session.enqueue("sin respuesta");
  assert.match(sent[0].text, /no pude leer la respuesta/);
  assert.equal(session.queued, 0);
});

test("un fallo al leer la respuesta tras enviar no se anuncia como fallo de envío", async () => {
  const prompts = [];
  const sent = [];
  const session = createChatSession({
    herdr: {
      request: async (method, params) => {
        if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "claude" }] };
        prompts.push(params.text);
        return { agent: {} };
      },
    },
    sendText: async (roomId, text) => sent.push(text),
    roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    read: async () => { throw new Error("ENOENT: no such file or directory"); },
    state: { sessionId: "s1", cwd: "/r" },
  });
  await session.enqueue("hola");
  assert.deepEqual(prompts, ["hola"]);
  assert.match(sent[0], /no pude leer la respuesta/);
  assert.doesNotMatch(sent[0], /no se pudo enviar/);
  assert.equal(session.queued, 0);
});

test("si el panel pasa a otro agente entre mensajes, no se envía y la sesión queda en pausa", async () => {
  let kind = "claude";
  const prompts = [];
  const sent = [];
  let saved = null;
  const session = createChatSession({
    herdr: {
      request: async (method, params) => {
        if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: kind }] };
        if (method === "agent.prompt") { prompts.push(params.text); return { agent: { agent_session: { value: "s1" }, cwd: "/r" } }; }
        throw new Error(`no simulado ${method}`);
      },
    },
    sendText: async (roomId, text) => sent.push(text),
    roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async (data) => { saved = data; }, log: () => {},
    read: async () => "respuesta",
    state: { agentKind: "claude", cwd: "/r" },
  });
  await session.enqueue("uno");
  kind = "opencode";
  await session.enqueue("dos");
  assert.deepEqual(prompts, ["uno"]);
  assert.equal(session.queued, 1);
  assert.equal(session.awaitingResume, true);
  assert.equal(saved.awaitingResume, true);
  assert.match(sent.at(-1), /sesión en pausa: el agente del workspace ahora es opencode, no claude/);
});

test("sin agente identificado en el workspace la sesión se pausa y no envía", async () => {
  const prompts = [];
  const session = createChatSession({
    herdr: {
      request: async (method, params) => {
        if (method === "agent.list") return { agents: [] };
        prompts.push(params);
        return {};
      },
    },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, state: { agentKind: "claude" },
  });
  await session.enqueue("hola");
  assert.equal(prompts.length, 0);
  assert.equal(session.awaitingResume, true);
  assert.equal(session.queued, 1);
});

test("confirmar tras una pausa reintenta con el mismo agente y envía", async () => {
  let kind = "opencode";
  const prompts = [];
  const sent = [];
  const session = createChatSession({
    herdr: {
      request: async (method, params) => {
        if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: kind }] };
        if (method === "agent.prompt") prompts.push(params.text);
        return { agent: { agent_session: { value: "s1" }, cwd: "/r" } };
      },
    },
    sendText: async (roomId, text) => sent.push(text),
    roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, read: async () => "ok",
    state: { agentKind: "claude", cwd: "/r" },
  });
  kind = "opencode";
  await session.enqueue("pendiente");
  assert.equal(session.awaitingResume, true);
  assert.equal(prompts.length, 0);
  kind = "claude";
  await session.resume();
  assert.deepEqual(prompts, ["pendiente"]);
  assert.equal(session.queued, 0);
  assert.equal(session.awaitingResume, false);
});

test("open de otro tipo olvida el ID de sesión del tipo anterior", async () => {
  const session = createChatSession({
    herdr: { request: async (method) => (method === "agent.list" ? { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", cwd: "/p" }] } : {}) },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, state: { agentKind: "claude", sessionId: "uuid-de-claude", cwd: "/viejo" },
  });
  await session.open("opencode");
  assert.equal(session.snapshot().sessionId, null);
  assert.equal(session.snapshot().cwd, "/p");
});

test("open de claude rechaza un panel con opencode", async () => {
  const herdr = {
    request: async (method) => {
      if (method !== "agent.list") throw new Error(`no debe llamarse ${method}`);
      return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", agent_status: "idle", interactive_ready: true }] };
    },
  };
  const session = createChatSession({
    herdr, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, sleep: async () => {},
  });
  await assert.rejects(session.open("claude"), /el agente del workspace es opencode, no claude/);
  assert.equal(session.queued, 0);
});

test("tras reiniciar, la cola queda en pausa hasta confirmar", async () => {
  const state = { queue: [{ text: "pendiente", at: Date.now() }], sessionId: "sess-1", cwd: "/repo" };
  const { session, prompts } = fakeChat({ replies: { pendiente: "ya" }, state });
  session.pauseForResume();
  await session.enqueue("nuevo");
  assert.deepEqual(prompts, []);
  assert.equal(session.awaitingResume, true);
  await session.resume();
  assert.deepEqual(prompts, ["pendiente", "nuevo"]);
});

test("descartar borra la cola pendiente", async () => {
  const state = { queue: [{ text: "a", at: 0 }, { text: "b", at: 0 }], sessionId: "s", cwd: "/r" };
  const { session, prompts } = fakeChat({ state });
  session.pauseForResume();
  await session.discard();
  assert.equal(session.queued, 0);
  assert.equal(session.awaitingResume, false);
  assert.deepEqual(prompts, []);
});

test("la sesión persiste su estado y el gestor la recupera", async () => {
  let stored = null;
  const manager = createChatManager({
    herdr: { request: async () => ({}) },
    sendText: async () => {},
    persistAll: async (items) => { stored = items; },
    restore: [],
    log: () => {},
    now: () => Date.now(),
  });
  manager.create({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1" });
  await manager.close(ROOM);
  assert.deepEqual(stored, []);
  assert.equal(manager.has(ROOM), false);
});

// Entrada: el flujo completo de chat desde la sala de un espacio.
function inboundHarness() {
  let clock = 1_000_000_000_000;
  const replies = [];
  const config = {
    owner: OWNER,
    control_room_id: CONTROL,
    rooms: [{ workspace_id: "w1", label: "api", room_id: ROOM, status: "active" }],
  };
  const prompts = [];
  const herdr = {
    request: async (method, params) => {
      if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "claude", interactive_ready: true }] };
      if (method === "agent.start") return {};
      if (method === "agent.prompt") {
        prompts.push(params.text);
        return { agent: { agent_session: { value: "s1" }, cwd: "/repo" } };
      }
      return {};
    },
  };
  const chats = createChatManager({
    herdr,
    sendText: async (roomId, text) => replies.push({ roomId, text }),
    persistAll: async () => {},
    restore: [],
    log: () => {},
    now: () => clock,
  });
  const inbound = createInbound({
    herdr,
    sender: { sendText: async (roomId, text) => replies.push({ roomId, text }) },
    config,
    botUserId: BOT,
    isEncrypted: async () => true,
    membership: () => "join",
    audit: { record: async () => {} },
    log: () => {},
    chats,
    now: () => clock,
  });
  let counter = 0;
  const msg = (roomId, body) => ({ eventId: `$c${++counter}`, roomId, sender: OWNER, body, ts: clock });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { inbound, chats, replies, prompts, msg, settle };
}

test("chat pide confirmación, abre la sesión y los mensajes siguientes van al agente", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat"));
  assert.match(h.replies[0].text, /abrir una sesión de chat/);
  await h.inbound.handle(h.msg(ROOM, "confirmar"));
  await h.settle();
  assert.ok(h.prompts.includes(FORMAT_INSTRUCTION));
  assert.ok(h.chats.has(ROOM));

  await h.inbound.handle(h.msg(ROOM, "¿qué hay en el repo?"));
  await h.settle();
  assert.ok(h.replies.some((r) => r.text.startsWith("recibido; en cola")));
  assert.equal(h.prompts.at(-1), "¿qué hay en el repo?");
});

test("chat con la sesión ya abierta avisa y no se envía al agente", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat"));
  await h.inbound.handle(h.msg(ROOM, "confirmar"));
  await h.settle();
  const before = h.prompts.length;
  await h.inbound.handle(h.msg(ROOM, "chat"));
  await h.settle();
  assert.match(h.replies.at(-1).text, /ya hay una sesión de chat abierta/);
  assert.equal(h.prompts.length, before);
  assert.equal(h.chats.get(ROOM).queued, 0);
});

test("con la sesión en pausa, cada mensaje avisa de la pausa en la sala", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat"));
  await h.inbound.handle(h.msg(ROOM, "confirmar"));
  await h.settle();
  h.chats.get(ROOM).snapshot().queue.push({ text: "pendiente", at: 0 });
  h.chats.get(ROOM).pauseForResume();
  await h.inbound.handle(h.msg(ROOM, "hola"));
  await h.settle();
  assert.match(h.replies.at(-1).text, /en pausa; en cola: 2/);
  assert.equal(h.prompts.length, 1);
});

test("salir cierra la sesión de chat sin cerrar el agente", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat"));
  await h.inbound.handle(h.msg(ROOM, "confirmar"));
  await h.settle();
  await h.inbound.handle(h.msg(ROOM, "salir"));
  assert.equal(h.chats.has(ROOM), false);
  assert.ok(h.replies.some((r) => r.text.includes("el agente sigue abierto")));
});

test("chat no se abre desde la sala de control", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(CONTROL, "chat"));
  assert.match(h.replies[0].text, /desde la sala del espacio/);
  assert.equal(h.chats.has(CONTROL), false);
});

test("open con un agente ocupado no falla: el formato se envía al quedar libre", async () => {
  const prompts = [];
  const herdr = {
    request: async (method, params) => {
      if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "working" }] };
      if (method === "agent.prompt") {
        prompts.push(params.text);
        return { agent: { agent_session: { value: "s" }, cwd: "/r" } };
      }
      throw new Error(`no simulado ${method}`);
    },
  };
  const session = createChatSession({
    herdr, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, sleep: async () => {},
  });
  await session.open();
  for (let i = 0; i < 10 && session.queued > 0; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(prompts, [FORMAT_INSTRUCTION]);
  assert.equal(session.queued, 0);
});

test("open de un agente nuevo espera a que esté listo y falla si no lo está", async () => {
  let clock = 0;
  const herdr = {
    request: async (method) => {
      if (method === "agent.list") return { agents: [] };
      if (method === "agent.start") return {};
      throw new Error(`no simulado ${method}`);
    },
  };
  const session = createChatSession({
    herdr, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, now: () => (clock += 60_000), sleep: async () => {},
  });
  await assert.rejects(session.open(), /no quedó listo/);
});

test("salir sin sesión abierta avisa en lugar de rechazar la orden", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "Salir"));
  assert.match(h.replies.at(-1).text, /no hay ninguna sesión de chat abierta/);
});

test("chat opencode abre opencode y chat sin tipo abre claude", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat opencode"));
  assert.match(h.replies[0].text, /con opencode en api/);
  const k = inboundHarness();
  await k.inbound.handle(k.msg(ROOM, "chat"));
  assert.match(k.replies[0].text, /con claude en api/);
});

test("chat con un tipo de agente desconocido no abre sesión", async () => {
  const h = inboundHarness();
  await h.inbound.handle(h.msg(ROOM, "chat gemini"));
  assert.equal(h.chats.has(ROOM), false);
  assert.match(h.replies[0].text, /orden no reconocida|no reconocida/);
});

// Herdr responde a agent.list con el agente del panel y su directorio de trabajo.
const opencodeHerdr = (cwd) => ({
  request: async (method) => {
    if (method !== "agent.list") throw new Error(`no debe llamarse ${method}`);
    return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", cwd }] };
  },
});

test("un agente de otro workspace nunca responde en esta sesión", async () => {
  const session = createChatSession({
    herdr: {
      request: async () => ({
        agents: [{ pane_id: "w2:p1", workspace_id: "w2", agent: "opencode", cwd: "/otro/proyecto" }],
      }),
    },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, runAgentOpencode: async () => "ses_no", readOpencode: async () => null,
  });
  await assert.rejects(session.open("opencode"), /no hay opencode detectado en el workspace/);
});

test("el panel del agente se toma del workspace, no se supone p1", async () => {
  const calls = [];
  const session = createChatSession({
    herdr: {
      request: async (method) => {
        if (method !== "agent.list") throw new Error(`no debe llamarse ${method}`);
        return { agents: [{ pane_id: "w1:p3", workspace_id: "w1", agent: "opencode", cwd: "/proyectos/uno" }] };
      },
    },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    runAgentOpencode: async (args) => { calls.push(args); return "ses_p3"; },
    readOpencode: async () => null,
  });
  await session.open("opencode");
  await session.enqueue("hola");
  assert.equal(session.snapshot().paneId, "w1:p3");
  assert.equal(calls[0].cwd, "/proyectos/uno");
});

test("más de un agente en el workspace es ambiguo y no se abre el chat", async () => {
  const session = createChatSession({
    herdr: {
      request: async () => ({
        agents: [
          { pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", cwd: "/a" },
          { pane_id: "w1:p2", workspace_id: "w1", agent: "claude", cwd: "/a" },
        ],
      }),
    },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, runAgentOpencode: async () => "x", readOpencode: async () => null,
  });
  await assert.rejects(session.open("opencode"), /más de un agente/);
});

test("opencode usa el directorio del panel del workspace, no el del bridge", async () => {
  const calls = [];
  const session = createChatSession({
    herdr: opencodeHerdr("/proyectos/uno"), sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    runAgentOpencode: async (args) => { calls.push(args); return "ses_c"; },
    readOpencode: async () => null,
  });
  await session.open("opencode");
  await session.enqueue("hola");
  assert.equal(calls[0].cwd, "/proyectos/uno");
});

test("abrir opencode sin agente detectado en el panel falla", async () => {
  const session = createChatSession({
    herdr: { request: async () => ({ agents: [] }) }, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, runAgentOpencode: async () => "ses_no", readOpencode: async () => null,
  });
  await assert.rejects(session.open("opencode"), /no hay opencode detectado/);
});

test("opencode envía con runOpencode y lee la respuesta de la base, sin tocar el panel", async () => {
  const calls = [];
  const sent = [];
  const herdr = opencodeHerdr("/proyectos/uno");
  const session = createChatSession({
    herdr,
    sendText: async (roomId, text) => sent.push(text),
    roomId: ROOM,
    workspaceId: "w1",
    paneId: "w1:p1",
    persist: async () => {},
    log: () => {},
    runAgentOpencode: async (args) => {
      calls.push(args);
      return args.sessionId ?? "ses_nueva";
    },
    readOpencode: async ({ sessionId, sentText }) => `respuesta a ${sentText} en ${sessionId}`,
  });
  await session.open("opencode");
  await session.enqueue("hola");
  assert.equal(calls[0].text, "hola");
  assert.equal(calls[0].sessionId, null);
  assert.equal(calls[0].auto, true);
  assert.deepEqual(sent, ["respuesta a hola en ses_nueva"]);
});

test("con opencode_auto desactivado, el envío a opencode no pide auto", async () => {
  const calls = [];
  const session = createChatSession({
    herdr: opencodeHerdr("/proyectos/uno"), sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, opencodeAuto: false,
    runAgentOpencode: async (args) => { calls.push(args); return "ses_x"; },
    readOpencode: async () => null,
  });
  await session.open("opencode");
  await session.enqueue("x");
  assert.equal(calls[0].auto, false);
});

test("opencode no envía la instrucción de formato al abrir", async () => {
  const calls = [];
  const session = createChatSession({
    herdr: opencodeHerdr("/proyectos/uno"), sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    runAgentOpencode: async (args) => { calls.push(args); return "ses_y"; },
    readOpencode: async () => null,
  });
  await session.open("opencode");
  assert.deepEqual(calls, []);
});

test("un fallo al enviar a opencode se avisa en la sala y la cola sigue", async () => {
  const sent = [];
  let attempts = 0;
  const session = createChatSession({
    herdr: { request: async () => ({ agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode" }] }) },
    sendText: async (roomId, text) => sent.push(text), roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    runAgentOpencode: async ({ text }) => {
      attempts++;
      if (text === "primero") throw new Error("tiempo agotado");
      return "ses_z";
    },
    readOpencode: async ({ sentText }) => `ok ${sentText}`,
    state: { agentKind: "opencode" },
  });
  await session.enqueue("primero");
  await session.enqueue("segundo");
  assert.match(sent[0], /no se pudo enviar el mensaje al agente: tiempo agotado/);
  assert.equal(sent[1], "ok segundo");
  assert.equal(session.queued, 0);
});

test("opencode usa la sesión que muestra el panel, no una nueva", async () => {
  const sessions = [];
  const session = createChatSession({
    herdr: {
      request: async (method) => {
        if (method !== "agent.list") throw new Error(`no simulado ${method}`);
        return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode", cwd: "/p", agent_session: { value: "ses_pane" } }] };
      },
    },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, state: { agentKind: "claude", sessionId: "ses_vieja" },
    runAgentOpencode: async ({ sessionId }) => { sessions.push(sessionId); return sessionId; },
    readOpencode: async () => "ok",
  });
  await session.open("opencode");
  assert.equal(session.snapshot().sessionId, "ses_pane");
  await session.enqueue("hola");
  assert.deepEqual(sessions, ["ses_pane"]);
});

test("un permiso de opencode queda pendiente hasta que el dueño permite o rechaza", async () => {
  const decisions = [];
  let finish;
  const session = createChatSession({
    herdr: { request: async () => ({ agents: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "opencode" }] }) },
    sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {}, opencodeAuto: false,
    runAgentOpencode: async ({ onPermission }) => {
      onPermission({ id: "per_1", action: "bash", resources: ["rm x"] });
      await new Promise((resolve) => { finish = resolve; });
      return "ses_1";
    },
    replyAgentPermission: async (args) => decisions.push(args),
    readOpencode: async () => "ok",
    state: { agentKind: "opencode", sessionId: "ses_1", cwd: "/p" },
  });
  const running = session.enqueue("hola");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.hasPendingPermission, true);
  assert.equal(await session.decidePermission("once"), true);
  assert.deepEqual(decisions, [{ sessionId: "ses_1", requestId: "per_1", decision: "once" }]);
  assert.equal(session.hasPendingPermission, false);
  assert.equal(await session.decidePermission("reject"), false);
  finish();
  await running;
});

test("interrupt en una sesión de opencode llama a la API; con otro agente no hace nada", async () => {
  const calls = [];
  const opencode = createChatSession({
    herdr: { request: async () => ({}) }, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    interruptAgent: async (args) => calls.push(args),
    state: { agentKind: "opencode", sessionId: "ses_1" },
  });
  assert.equal(await opencode.interrupt(), true);
  assert.deepEqual(calls, [{ sessionId: "ses_1" }]);
  const claude = createChatSession({
    herdr: { request: async () => ({}) }, sendText: async () => {}, roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
    persist: async () => {}, log: () => {},
    interruptAgent: async (args) => calls.push(args),
    state: { agentKind: "claude", sessionId: "s" },
  });
  assert.equal(await claude.interrupt(), false);
  assert.equal(calls.length, 1);
});
