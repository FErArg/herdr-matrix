import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, createChatManager, createChatSession, FORMAT_INSTRUCTION, opencodeArgs } from "../src/chat.mjs";
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

test("transcriptPath cambia / y . del directorio de trabajo por guiones", () => {
  assert.equal(
    transcriptPath("/home/owner/Git/projects/herdr-matrix", "abc", "/home/owner"),
    "/home/owner/.claude/projects/-home-owner-Git-projects-herdr-matrix/abc.jsonl",
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
      if (method === "agent.list") return { agents: [{ pane_id: "w1:p1" }] };
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
      if (method === "agent.list") return { agents: [{ pane_id: "w1:p1", interactive_ready: true }] };
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

test("open espera a que el agente esté listo antes de enviar el formato", async () => {
  const prompts = [];
  let polls = 0;
  const herdr = {
    request: async (method, params) => {
      if (method === "agent.list") {
        polls++;
        // Primero el agente existe pero no acepta entrada; luego sí.
        return { agents: [{ pane_id: "w1:p1", workspace_id: "w1", interactive_ready: polls >= 3 }] };
      }
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
  assert.equal(polls, 3);
  assert.deepEqual(prompts, [FORMAT_INSTRUCTION]);
});

test("open falla si el agente nunca queda listo", async () => {
  let clock = 0;
  const herdr = { request: async () => ({ agents: [{ pane_id: "w1:p1", interactive_ready: false }] }) };
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

test("opencodeReplyAfter devuelve solo el texto del asistente tras el mensaje enviado", async () => {
  const { opencodeReplyAfter } = await import("../src/transcript.mjs");
  const messages = [
    { id: "msg_1", role: "user", created: 1, parts: [{ type: "text", text: "anterior" }] },
    { id: "msg_2", role: "assistant", created: 2, parts: [{ type: "text", text: "vieja" }] },
    { id: "msg_3", role: "user", created: 3, parts: [{ type: "text", text: "cuánto es 2+2" }] },
    { id: "msg_4", role: "assistant", created: 4, parts: [{ type: "reasoning", text: "pienso" }, { type: "text", text: "4" }] },
    { id: "msg_5", role: "assistant", created: 5, parts: [{ type: "text", text: "y además" }] },
  ];
  assert.equal(opencodeReplyAfter(messages, "cuánto es 2+2"), "4\n\ny además");
  assert.equal(opencodeReplyAfter(messages, "no está"), null);
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

test("opencodeArgs incluye --auto solo si está activado", () => {
  const withAuto = opencodeArgs({ sessionId: "ses_1", text: "hola", auto: true });
  assert.ok(withAuto.includes("--auto"));
  assert.deepEqual(withAuto.slice(-3), ["--session", "ses_1", "hola"]);
  assert.ok(!opencodeArgs({ sessionId: null, text: "hola", auto: false }).includes("--auto"));
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
    herdr: { request: async () => ({}) }, sendText: async (roomId, text) => sent.push(text), roomId: ROOM, workspaceId: "w1", paneId: "w1:p1",
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
