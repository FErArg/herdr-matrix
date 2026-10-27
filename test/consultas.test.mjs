import { test } from "node:test";
import assert from "node:assert/strict";
import { consultaOf, formatCambios, formatDetalle, formatVer, gitState, DETALLE_MAX } from "../src/consultas.mjs";
import { createInbound } from "../src/inbound.mjs";

const OWNER = "@owner:hs.example.org";
const BOT = "@herdr-test:hs.example.org";
const CONTROL = "!control:hs.example.org";
const PROJECT = "!api:hs.example.org";
const OTHER = "!web:hs.example.org";

test("consultaOf reconoce las órdenes sueltas y detalle con número", () => {
  assert.deepEqual(consultaOf("ver"), { verb: "ver", n: null });
  assert.deepEqual(consultaOf("Cambios."), { verb: "cambios", n: null });
  assert.deepEqual(consultaOf("cancelar"), { verb: "cancelar", n: null });
  assert.deepEqual(consultaOf("detalle"), { verb: "detalle", n: 10 });
  assert.deepEqual(consultaOf("detalle 3"), { verb: "detalle", n: 3 });
  assert.deepEqual(consultaOf("detalle 999"), { verb: "detalle", n: DETALLE_MAX });
  assert.deepEqual(consultaOf("detalle abc"), { verb: "detalle", n: null });
});

test("consultaOf deja pasar al agente el texto que no es una consulta", () => {
  assert.equal(consultaOf("ver si el test pasa"), null);
  assert.equal(consultaOf("cambios en el módulo X"), null);
  assert.equal(consultaOf("hola"), null);
});

test("formatDetalle muestra las últimas n acciones y redacta secretos", () => {
  const actions = [
    { name: "Read", detail: "/p/a.mjs" },
    { name: "Bash", detail: "API_KEY=abc npm test" },
    { name: "Edit", detail: "/p/b.mjs" },
  ];
  assert.equal(formatDetalle(actions, 2), "Últimas 2 acciones:\n1. Bash: API_KEY=[oculto] npm test\n2. Edit: /p/b.mjs");
});

test("formatDetalle sin acciones o sin detalle disponible", () => {
  assert.equal(formatDetalle([], 5), "no hay acciones en el turno actual.");
  assert.equal(formatDetalle(null, 5), "detalle no disponible para este agente.");
});

test("formatVer parte la respuesta en trozos y redacta", () => {
  const chunks = formatVer({ reply: `token sk-abcdefghijk\n${"x".repeat(5000)}` });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 3500));
  assert.match(chunks[0], /\[oculto\]/);
  assert.deepEqual(formatVer({ reply: null }), ["no hay respuesta en el turno actual."]);
});

test("formatCambios lista los ficheros y el resumen de diff", () => {
  const text = formatCambios({ status: " M src/a.mjs\n?? src/b.mjs\n", stat: " src/a.mjs | 2 +-\n 2 files changed\n" });
  assert.equal(text, "Cambios sin confirmar (2):\n M src/a.mjs\n?? src/b.mjs\n2 files changed");
  assert.equal(formatCambios({ status: "", stat: "" }), "no hay cambios sin confirmar en el proyecto.");
});

test("gitState pide el estado y el diff al directorio del proyecto", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    return args.includes("status") ? " M x\n" : " x | 1 +\n";
  };
  const state = await gitState("/proy", run);
  assert.deepEqual(calls, [
    ["git", "-C", "/proy", "status", "--short"],
    ["git", "-C", "/proy", "diff", "--stat"],
  ]);
  assert.deepEqual(state, { status: " M x\n", stat: " x | 1 +\n" });
});

// Sesión de chat simulada: solo la parte que usan las consultas.
function harness({ session = true, turn = null } = {}) {
  let clock = 1_000_000_000_000;
  let counter = 0;
  const replies = [];
  const audits = [];
  const enqueued = [];
  const herdrCalls = [];
  const config = {
    config_version: 1,
    owner: OWNER,
    control_room_id: CONTROL,
    rooms: [
      { workspace_id: "w1", label: "api", room_id: PROJECT, status: "active" },
      { workspace_id: "w2", label: "web", room_id: OTHER, status: "active" },
    ],
  };
  const chatSession = {
    snapshot: () => ({ cwd: "/proy", paneId: "w1:p1" }),
    turn: async () => turn,
    enqueue: async (text) => { enqueued.push(text); },
    interrupt: async () => false,
  };
  const chats = {
    has: (roomId) => session && roomId === PROJECT,
    get: (roomId) => (session && roomId === PROJECT ? chatSession : null),
  };
  const inbound = createInbound({
    herdr: { request: async (method, params) => { herdrCalls.push({ method, params }); return { type: "ok" }; } },
    sender: { sendText: async (roomId, text) => { replies.push({ roomId, text }); } },
    config,
    botUserId: BOT,
    isEncrypted: async () => true,
    membership: () => "join",
    audit: { record: async (entry) => { audits.push(entry); } },
    log: () => {},
    chats,
    now: () => clock,
  });
  const msg = (body, roomId = PROJECT) => ({ eventId: `$e${++counter}`, roomId, sender: OWNER, body, ts: clock });
  return { inbound, msg, replies, audits, enqueued, herdrCalls, advance: (ms) => { clock += ms; } };
}

const TURN = {
  request: "pedido",
  reply: "Hecho.",
  files: ["a.mjs"],
  problems: [],
  actions: [{ name: "Read", detail: "/p/a" }, { name: "Bash", detail: "npm test" }],
};

test("sin sesión de chat, las consultas se ignoran: ni responden ni llegan al agente", async () => {
  const h = harness({ session: false });
  await h.inbound.handle(h.msg("ver"));
  assert.deepEqual(h.replies, []);
  assert.equal(h.audits.at(-1).result, "ignorada: sin sesión de chat");
});

test("con sesión, detalle responde con las últimas acciones y no llega al agente", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("detalle 1"));
  assert.equal(h.replies[0].text, "Últimas 1 acciones:\n1. Bash: npm test");
  assert.deepEqual(h.enqueued, []);
});

test("ver responde con la respuesta completa del turno", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("ver"));
  assert.equal(h.replies[0].text, "Hecho.");
});

test("cambios sin directorio de proyecto avisa en lugar de inventar uno", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("cambios"));
  assert.match(h.replies.at(-1).text, /no se pudo leer el estado de git/);
});

test("cancelar pide confirmación y envía Escape al panel de la sesión al confirmar", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("cancelar"));
  assert.match(h.replies[0].text, /¿enviar Escape al panel w1:p1\?/);
  assert.deepEqual(h.herdrCalls, []);
  await h.inbound.handle(h.msg("confirmar"));
  assert.deepEqual(h.herdrCalls, [{ method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["esc"] } }]);
});

test("una consulta desde otra sala con sesión no usa la sesión de esta sala", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("ver", OTHER));
  assert.deepEqual(h.replies, []);
  assert.equal(h.audits.at(-1).result, "ignorada: sin sesión de chat");
});

test("en la sala de control, detalle no es una consulta: sigue como orden desconocida", async () => {
  const h = harness({ turn: TURN });
  await h.inbound.handle(h.msg("detalle", CONTROL));
  assert.match(h.replies.at(-1).text, /no reconocida|no está en la lista|orden/i);
});
