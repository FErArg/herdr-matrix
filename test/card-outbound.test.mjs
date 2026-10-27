import { test } from "node:test";
import assert from "node:assert/strict";
import { createCards } from "../src/cards.mjs";
import { createOutbound } from "../src/outbound.mjs";

const ROOM = "!api:hs.example.org";
const CONTROL = "!control:hs.example.org";
const config = {
  control_room_id: CONTROL,
  rooms: [{ workspace_id: "w1", room_id: ROOM, status: "active" }],
};

const agent = (overrides) => ({
  pane_id: "w1:p1",
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent: "claude",
  agent_status: "idle",
  state_change_seq: 1,
  ...overrides,
});

function fakeHerdr(state) {
  return {
    request: async (method) => {
      if (method === "agent.list") return { agents: state.agents };
      if (method === "workspace.list") return { workspaces: [{ workspace_id: "w1", label: "api" }, { workspace_id: "w2", label: "web" }] };
      if (method === "pane.read") return { read: { text: "¿Permitir la edición?\n1) Sí\n2) No" } };
      throw new Error(`método no simulado ${method}`);
    },
  };
}

function recordingSender() {
  const sent = [];
  const edits = [];
  let counter = 0;
  return {
    sent,
    edits,
    sendText: async (roomId, text) => {
      counter++;
      sent.push({ roomId, text, eventId: `$m${counter}` });
      return `$m${counter}`;
    },
    editText: async (roomId, eventId, text) => {
      edits.push({ roomId, eventId, text });
      return "$edit";
    },
  };
}

// Sesión de chat solo en w1: la tarjeta existe únicamente allí.
const chats = {
  findByWorkspace: (workspaceId) => (workspaceId === "w1"
    ? { roomId: ROOM, turn: async () => ({ request: "añade tests", reply: "Hecho.", files: ["a.mjs"], problems: [] }) }
    : null),
};

test("la tarjeta sigue la tarea: abre, muestra la decisión, reanuda y cierra", async () => {
  const state = { agents: [agent({})] };
  const sender = recordingSender();
  const cards = createCards({ sender, persist: async () => {}, log: () => {} });
  const outbound = createOutbound({
    herdr: fakeHerdr(state), sender, config, chats, cards,
    snapshot: {}, saveSnapshot: async () => {}, log: () => {}, rateLimitMs: 0,
  });

  await outbound.reconcile();
  state.agents = [agent({ agent_status: "working", state_change_seq: 2 })];
  await outbound.reconcile();
  assert.equal(sender.sent[0].text, "Tarea: añade tests\nEstado: trabajando");

  state.agents = [agent({ agent_status: "blocked", state_change_seq: 3 })];
  await outbound.reconcile();
  assert.match(sender.edits[0].text, /Estado: necesita decisión\n¿Permitir la edición\?\n1\) Sí\n2\) No/);
  assert.equal(sender.edits[0].eventId, "$m1");
  assert.match(sender.sent.at(-1).text, /\] blocked: claude requiere atención$/);

  state.agents = [agent({ agent_status: "working", state_change_seq: 4 })];
  await outbound.reconcile();
  assert.equal(sender.edits[1].text, "Tarea: añade tests\nEstado: trabajando");

  state.agents = [agent({ agent_status: "idle", state_change_seq: 5 })];
  await outbound.reconcile();
  assert.equal(sender.edits.at(-1).text, "Tarea: añade tests\nEstado: terminó\nHecho: Hecho.\nCambios: a.mjs\nProblemas: ninguno");
  assert.equal(cards.get("w1:p1"), null);
  assert.ok(sender.edits.every((edit) => edit.eventId === "$m1"));
});

test("un workspace sin sesión de chat no abre tarjeta; sus avisos siguen igual", async () => {
  const state = { agents: [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" })] };
  const sender = recordingSender();
  const cards = createCards({ sender, persist: async () => {}, log: () => {} });
  const outbound = createOutbound({
    herdr: fakeHerdr(state), sender, config, chats, cards,
    snapshot: {}, saveSnapshot: async () => {}, log: () => {}, rateLimitMs: 0,
  });
  await outbound.reconcile();
  state.agents = [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", agent_status: "working", state_change_seq: 2 })];
  await outbound.reconcile();
  state.agents = [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", agent_status: "idle", state_change_seq: 3 })];
  const result = await outbound.reconcile();
  assert.deepEqual(sender.sent, []);
  assert.deepEqual(sender.edits, []);
  assert.equal(result.dropped, 1);
  assert.equal(cards.all().length, 0);
});

test("un fallo al abrir la tarjeta no detiene el ciclo de avisos", async () => {
  const state = { agents: [agent({})] };
  const sender = recordingSender();
  const logged = [];
  const failing = { ...sender, sendText: async (roomId, text) => {
    if (text.startsWith("Tarea:")) throw new Error("sin red");
    return sender.sendText(roomId, text);
  } };
  const cards = createCards({ sender: failing, persist: async () => {}, log: () => {} });
  const outbound = createOutbound({
    herdr: fakeHerdr(state), sender: failing, config, chats, cards,
    snapshot: {}, saveSnapshot: async () => {}, log: (line) => logged.push(line), rateLimitMs: 0,
  });
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "working", state_change_seq: 2 })];
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "blocked", state_change_seq: 3 })];
  const result = await outbound.reconcile();
  assert.equal(result.sent, 1);
  assert.match(logged.join("\n"), /tarjeta \(started en w1:p1\): sin red/);
});
