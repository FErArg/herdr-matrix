import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIRM_TIMEOUT_MS, createInbound, MAX_AGE_MS, RATE_LIMIT } from "../src/inbound.mjs";

const OWNER = "@owner:hs.example.org";
const BOT = "@bot-test:hs.example.org";
const CONTROL = "!control:hs.example.org";
const PROJECT = "!api:hs.example.org";
const OTHER = "!web:hs.example.org";

const AGENTS = [
  { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", agent: "claude", agent_status: "blocked" },
  { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", agent: "codex", agent_status: "working" },
];

function harness({ failWrites = false, encrypted = true, membership = "join" } = {}) {
  let clock = 1_000_000_000_000;
  let counter = 0;
  const herdrCalls = [];
  const replies = [];
  const audits = [];
  const config = {
    config_version: 1,
    owner: OWNER,
    control_room_id: CONTROL,
    rooms: [
      { workspace_id: "w1", label: "api", room_id: PROJECT, status: "active" },
      { workspace_id: "w2", label: "web", room_id: OTHER, status: "active" },
      { workspace_id: "w3", label: "viejo", room_id: "!old:hs.example.org", status: "archived" },
    ],
  };
  const herdr = {
    request: async (method, params) => {
      herdrCalls.push({ method, params });
      if (method === "agent.list") return { agents: AGENTS };
      if (method === "pane.read") return { read: { text: "línea\u0007 uno\nlínea dos" } };
      if (failWrites && method.startsWith("pane.send")) throw new Error("socket caído");
      return { type: "ok" };
    },
  };
  const inbound = createInbound({
    herdr,
    sender: { sendText: async (roomId, text) => { replies.push({ roomId, text }); } },
    config,
    botUserId: BOT,
    isEncrypted: async () => encrypted,
    membership: () => membership,
    audit: { record: async (entry) => { audits.push(entry); } },
    log: () => {},
    now: () => clock,
  });
  const msg = (overrides = {}) => ({
    eventId: `$e${++counter}`,
    roomId: PROJECT,
    sender: OWNER,
    body: "estado",
    ts: clock,
    ...overrides,
  });
  const writes = () => herdrCalls.filter((call) => call.method.startsWith("pane.send"));
  return {
    inbound,
    msg,
    herdrCalls,
    replies,
    audits,
    writes,
    advance: (ms) => { clock += ms; },
  };
}

test("estado en la sala de control lista los agentes de todos los espacios", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ roomId: CONTROL }));
  assert.equal(h.replies.length, 1);
  assert.match(h.replies[0].text, /\[api · w1:p1\] blocked: claude/);
  assert.match(h.replies[0].text, /\[web · w2:p1\] working: codex/);
});

test("estado en una sala de workspace solo lista su espacio", async () => {
  const h = harness();
  await h.inbound.handle(h.msg());
  assert.match(h.replies[0].text, /w1:p1/);
  assert.doesNotMatch(h.replies[0].text, /w2:p1/);
});

test("leer limpia caracteres de control de la salida del panel", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ roomId: CONTROL, body: "leer w2:p1" }));
  assert.equal(h.herdrCalls.at(-1).method, "pane.read");
  assert.equal(h.herdrCalls.at(-1).params.source, "recent");
  assert.equal(h.replies[0].text, "línea uno\nlínea dos");
});

test("enviar en la sala de control se rechaza sin escribir", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ roomId: CONTROL, body: "enviar w1:p1 hola" }));
  assert.equal(h.writes().length, 0);
  assert.match(h.replies[0].text, /sala del espacio/);
});

test("enviar pide confirmación sin repetir el texto y no escribe hasta confirmar", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 secreto de prueba" }));
  assert.equal(h.writes().length, 0);
  assert.doesNotMatch(h.replies[0].text, /secreto/);
  assert.match(h.replies[0].text, /confirmar/);
});

test("confirmar ejecuta el envío y la auditoría no guarda el texto", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola mundo" }));
  await h.inbound.handle(h.msg({ body: "confirmar" }));
  assert.deepEqual(h.writes(), [{ method: "pane.send_text", params: { pane_id: "w1:p1", text: "hola mundo" } }]);
  assert.equal(h.audits.at(-1).result, "ok (confirmada)");
  assert.doesNotMatch(JSON.stringify(h.audits), /hola mundo/);
});

test("enter confirmado envía la tecla enter", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enter w1:p1" }));
  await h.inbound.handle(h.msg({ body: "confirmar" }));
  assert.deepEqual(h.writes()[0], { method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["enter"] } });
});

test("la confirmación caduca a los 60 s", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  h.advance(CONFIRM_TIMEOUT_MS + 1);
  await h.inbound.handle(h.msg({ body: "confirmar" }));
  assert.equal(h.writes().length, 0);
  assert.match(h.replies.at(-1).text, /caducado/);
});

test("cualquier otro mensaje cancela la acción pendiente", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  await h.inbound.handle(h.msg({ body: "estado" }));
  await h.inbound.handle(h.msg({ body: "confirmar" }));
  assert.equal(h.writes().length, 0);
  assert.ok(h.audits.some((entry) => entry.result === "cancelada por otro mensaje"));
});

test("confirmar desde otra sala no ejecuta la acción", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  await h.inbound.handle(h.msg({ roomId: OTHER, body: "confirmar" }));
  assert.equal(h.writes().length, 0);
});

test("un panel de otro espacio se rechaza en la sala del workspace", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w2:p1 hola" }));
  assert.equal(h.writes().length, 0);
  assert.match(h.replies[0].text, /no pertenece a este espacio/);
});

test("un verbo fuera de la tabla no llama a Herdr", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "borrar w1:p1" }));
  assert.equal(h.herdrCalls.length, 0);
  assert.equal(h.replies[0].text, "orden no reconocida");
});

test("un remitente que no es el dueño se ignora sin responder", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ sender: "@intruso:hs.example.org", body: "enviar w1:p1 hola" }));
  assert.equal(h.replies.length, 0);
  assert.equal(h.herdrCalls.length, 0);
  assert.equal(h.audits[0].result, "no autorizado");
});

test("el dueño que no es miembro `join` de la sala se ignora", async () => {
  const h = harness({ membership: "leave" });
  await h.inbound.handle(h.msg());
  assert.equal(h.replies.length, 0);
  assert.equal(h.herdrCalls.length, 0);
});

test("una sala sin cifrado y un mensaje del propio bot se ignoran", async () => {
  const unencrypted = harness({ encrypted: false });
  await unencrypted.inbound.handle(unencrypted.msg());
  assert.equal(unencrypted.herdrCalls.length, 0);

  const h = harness();
  await h.inbound.handle(h.msg({ sender: BOT }));
  assert.equal(h.herdrCalls.length, 0);
});

test("un mensaje antiguo (más de 60 s) se ignora", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ ts: 1_000_000_000_000 - MAX_AGE_MS - 1 }));
  assert.equal(h.herdrCalls.length, 0);
});

test("un evento repetido se procesa una sola vez", async () => {
  const h = harness();
  const event = h.msg();
  await h.inbound.handle(event);
  await h.inbound.handle(event);
  assert.equal(h.replies.length, 1);
});

test("el límite de órdenes por remitente rechaza la undécima", async () => {
  const h = harness();
  for (let i = 0; i < RATE_LIMIT.max; i++) await h.inbound.handle(h.msg({ body: "estado" }));
  await h.inbound.handle(h.msg({ body: "estado" }));
  assert.match(h.replies.at(-1).text, /demasiadas órdenes/);
  h.advance(RATE_LIMIT.windowMs + 1);
  await h.inbound.handle(h.msg({ body: "estado" }));
  assert.match(h.replies.at(-1).text, /\[api · w1:p1\]/);
});

test("un fallo de Herdr al escribir da un mensaje genérico y lo audita", async () => {
  const h = harness({ failWrites: true });
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  await h.inbound.handle(h.msg({ body: "confirmar" }));
  assert.equal(h.replies.at(-1).text, "no se pudo ejecutar la orden.");
  assert.equal(h.audits.at(-1).result, "error: socket caído");
});

test("Confirmar con puntuación final confirma la acción pendiente", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  await h.inbound.handle(h.msg({ body: "Confirmar," }));
  assert.deepEqual(h.writes(), [{ method: "pane.send_text", params: { pane_id: "w1:p1", text: "hola" } }]);
});

test("una orden no reconocida se audita con su primera palabra y sin el resto", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "w2:p1 prueba secreta de escritura" }));
  assert.equal(h.audits.at(-1).result, 'rechazada: orden no reconocida (primera palabra: "w2:p1")');
  assert.doesNotMatch(JSON.stringify(h.audits), /secreta/);
});

test("una respuesta a pregunta de invitación se contesta en la sala de control y no llega a Herdr", async () => {
  const h = harness();
  const answers = [];
  const invites = { handle: async (body) => { answers.push(body); return "de acuerdo, no se invita a nadie."; } };
  // Reconstruye el módulo con la cola de invitaciones activa.
  const { createInbound: create } = await import("../src/inbound.mjs");
  const replies = [];
  const inbound = create({
    herdr: { request: async (method) => { h.herdrCalls.push({ method }); return {}; } },
    sender: { sendText: async (roomId, text) => replies.push({ roomId, text }) },
    config: { owner: OWNER, control_room_id: CONTROL, rooms: [] },
    botUserId: BOT,
    isEncrypted: async () => true,
    membership: () => "join",
    audit: { record: async () => {} },
    log: () => {},
    invites,
  });
  await inbound.handle({ eventId: "$inv1", roomId: CONTROL, sender: OWNER, body: "no", ts: Date.now() });
  assert.deepEqual(answers, ["no"]);
  assert.equal(replies[0].text, "de acuerdo, no se invita a nadie.");
  assert.equal(h.herdrCalls.length, 0);
});

test("la confirmación nombra el espacio y el panel", async () => {
  const h = harness();
  await h.inbound.handle(h.msg({ body: "enviar w1:p1 hola" }));
  assert.match(h.replies[0].text, /en api \(w1:p1\)\?/);
});
