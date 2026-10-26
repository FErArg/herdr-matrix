import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutbound, routeRoom } from "../src/outbound.mjs";

const CONTROL = "!control:hs.example.org";
const PROJECT = "!api:hs.example.org";

function fakeHerdr(state) {
  return {
    request: async (method) => {
      if (method === "agent.list") return { type: "agent_list", agents: state.agents };
      if (method === "workspace.list") {
        return {
          type: "workspace_list",
          workspaces: [
            { workspace_id: "w1", label: "api" },
            { workspace_id: "w2", label: "web" },
          ],
        };
      }
      throw new Error(`método no simulado ${method}`);
    },
  };
}

function recordingSender({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    sendText: async (roomId, text) => {
      if (fail) throw new Error("E2EE de salida pendiente");
      sent.push({ roomId, text });
    },
  };
}

const config = {
  config_version: 1,
  control_room_id: CONTROL,
  rooms: [
    { workspace_id: "w1", room_id: PROJECT, status: "active" },
    { workspace_id: "w3", room_id: "!old:hs.example.org", status: "archived" },
  ],
  notify_events: ["blocked", "done", "exited"],
};

const agent = (overrides) => ({
  pane_id: "w1:p1",
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent: "claude",
  agent_status: "working",
  state_change_seq: 1,
  ...overrides,
});

test("routeRoom usa la sala activa del workspace y no enruta sin sala activa", () => {
  assert.equal(routeRoom(config, "w1"), PROJECT);
  assert.equal(routeRoom(config, "w2"), null);
  assert.equal(routeRoom(config, "w3"), null);
});

test("la primera lectura solo registra línea base y no notifica", async () => {
  const state = { agents: [agent({ agent_status: "blocked" })] };
  const sender = recordingSender();
  const outbound = createOutbound({ herdr: fakeHerdr(state), sender, config, snapshot: {}, saveSnapshot: async () => {}, log: () => {} });
  const result = await outbound.reconcile();
  assert.equal(result.sent, 0);
  assert.deepEqual(sender.sent, []);
});

test("un cambio a blocked se envía a la sala del workspace con formato", async () => {
  const state = { agents: [agent()] };
  const sender = recordingSender();
  let saved = null;
  const outbound = createOutbound({
    herdr: fakeHerdr(state), sender, config, snapshot: {},
    saveSnapshot: async (data) => { saved = data; }, log: () => {}, rateLimitMs: 0,
  });
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "blocked", state_change_seq: 2 })];
  const result = await outbound.reconcile();

  assert.equal(result.sent, 1);
  assert.equal(sender.sent[0].roomId, PROJECT);
  assert.equal(sender.sent[0].text, "[api/w1:t1/w1:p1] blocked: claude requiere atención");
  assert.equal(saved.panes["w1:p1"].agent_status, "blocked");
});

test("un panel sin sala activa se descarta; no llega a la sala de control", async () => {
  const state = { agents: [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" })] };
  const sender = recordingSender();
  const outbound = createOutbound({ herdr: fakeHerdr(state), sender, config, snapshot: {}, saveSnapshot: async () => {}, log: () => {}, rateLimitMs: 0 });
  await outbound.reconcile();
  state.agents = [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", agent_status: "done", state_change_seq: 2 })];
  const result = await outbound.reconcile();
  assert.deepEqual(sender.sent, []);
  assert.equal(result.dropped, 1);
});

test("la reconciliación sincroniza las salas antes de enrutar", async () => {
  const state = { agents: [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1" })] };
  const sender = recordingSender();
  const local = { ...config, rooms: [...config.rooms] };
  const synced = [];
  // Simula la creación de la sala de w2 durante la primera sincronización.
  const rooms = {
    sync: async (workspaces) => {
      synced.push(workspaces.map((w) => w.workspace_id));
      if (!local.rooms.some((room) => room.workspace_id === "w2")) {
        local.rooms.push({ workspace_id: "w2", label: "web", room_id: "!web:hs.example.org", status: "active" });
      }
    },
  };
  const outbound = createOutbound({ herdr: fakeHerdr(state), sender, rooms, config: local, snapshot: {}, saveSnapshot: async () => {}, log: () => {}, rateLimitMs: 0 });
  await outbound.reconcile();
  state.agents = [agent({ pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", agent_status: "done", state_change_seq: 2 })];
  await outbound.reconcile();
  assert.deepEqual(synced, [["w1", "w2"], ["w1", "w2"]]);
  assert.equal(sender.sent[0].roomId, "!web:hs.example.org");
});

test("las reconciliaciones solapadas se ejecutan una a una", async () => {
  const state = { agents: [agent()] };
  let active = 0;
  let maxActive = 0;
  const slowHerdr = {
    request: async (method) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return fakeHerdr(state).request(method);
    },
  };
  const outbound = createOutbound({ herdr: slowHerdr, sender: recordingSender(), config, snapshot: {}, saveSnapshot: async () => {}, log: () => {} });
  await Promise.all([outbound.reconcile(), outbound.reconcile(), outbound.reconcile()]);
  assert.equal(maxActive, 1);
});

test("no se repite dentro de la ventana de frecuencia", async () => {
  const state = { agents: [agent()] };
  const sender = recordingSender();
  const outbound = createOutbound({ herdr: fakeHerdr(state), sender, config, snapshot: {}, saveSnapshot: async () => {}, log: () => {}, rateLimitMs: 60_000 });
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "blocked", state_change_seq: 2 })];
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "done", state_change_seq: 3 })];
  const result = await outbound.reconcile();
  assert.equal(sender.sent.length, 1);
  assert.equal(result.dropped, 1);
});

test("un envío fallido se cuenta y no detiene la lectura", async () => {
  const state = { agents: [agent()] };
  const logs = [];
  const outbound = createOutbound({
    herdr: fakeHerdr(state), sender: recordingSender({ fail: true }), config,
    snapshot: {}, saveSnapshot: async () => {}, log: (m) => logs.push(m), rateLimitMs: 0,
  });
  await outbound.reconcile();
  state.agents = [agent({ agent_status: "blocked", state_change_seq: 2 })];
  const result = await outbound.reconcile();
  assert.equal(result.failed, 1);
  assert.ok(logs.some((line) => line.includes("E2EE de salida pendiente")));
});
