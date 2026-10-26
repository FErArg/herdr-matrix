import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHIVED_NOTICE, createRoomManager, ROOM_STATE_TYPE } from "../src/rooms.mjs";

const OWNER = "@owner:hs.example.org";

function fakeMatrix({ failCreateFor = null } = {}) {
  let counter = 0;
  const calls = { created: [], state: [] };
  const levels = new Map();
  return {
    calls,
    levels,
    createEncryptedRoom: async ({ name, invite }) => {
      if (name === failCreateFor) throw new Error("servidor no disponible");
      counter++;
      const roomId = `!room${counter}:hs.example.org`;
      calls.created.push({ roomId, name, invite });
      levels.set(roomId, { events_default: 0, users_default: 0 });
      return roomId;
    },
    putState: async (roomId, type, content) => {
      calls.state.push({ roomId, type, content });
      if (type === "m.room.power_levels") levels.set(roomId, content);
      return "$event";
    },
    getState: async (roomId, type) => (type === "m.room.power_levels" ? levels.get(roomId) ?? null : null),
  };
}

function setup({ matrix = fakeMatrix(), config = { owner: OWNER, rooms: [] } } = {}) {
  const sent = [];
  const logs = [];
  let saves = 0;
  const manager = createRoomManager({
    matrix,
    sendText: async (roomId, text) => sent.push({ roomId, text }),
    config,
    saveConfig: async () => { saves++; },
    log: (line) => logs.push(line),
  });
  return { manager, matrix, config, sent, logs, saves: () => saves };
}

const workspace = (id, label) => ({ workspace_id: id, label });

test("un workspace nuevo crea una sala cifrada que invita al dueño y guarda el mapeo", async () => {
  const { manager, matrix, config, saves } = setup();
  await manager.sync([workspace("w1", "api")]);

  assert.deepEqual(matrix.calls.created, [{ roomId: "!room1:hs.example.org", name: "api", invite: [OWNER] }]);
  assert.deepEqual(config.rooms, [
    { workspace_id: "w1", label: "api", room_id: "!room1:hs.example.org", status: "active" },
  ]);
  assert.deepEqual(matrix.calls.state, [
    { roomId: "!room1:hs.example.org", type: ROOM_STATE_TYPE, content: { workspace_id: "w1" } },
  ]);
  assert.equal(saves(), 1);
});

test("una segunda sincronización con los mismos workspaces no crea salas", async () => {
  const { manager, matrix } = setup();
  await manager.sync([workspace("w1", "api")]);
  await manager.sync([workspace("w1", "api")]);
  assert.equal(matrix.calls.created.length, 1);
});

test("un cambio de etiqueta renombra la sala", async () => {
  const { manager, matrix, config } = setup();
  await manager.sync([workspace("w1", "api")]);
  await manager.sync([workspace("w1", "api-v2")]);

  const renamed = matrix.calls.state.find((call) => call.type === "m.room.name");
  assert.deepEqual(renamed, { roomId: "!room1:hs.example.org", type: "m.room.name", content: { name: "api-v2" } });
  assert.equal(config.rooms[0].label, "api-v2");
});

test("un workspace cerrado se archiva: solo lectura antes del aviso, sin borrar", async () => {
  const { manager, matrix, sent, config } = setup();
  await manager.sync([workspace("w1", "api")]);
  await manager.sync([]);

  const levels = matrix.calls.state.find((call) => call.type === "m.room.power_levels");
  assert.equal(levels.content.events_default, 100);
  assert.deepEqual(sent, [{ roomId: "!room1:hs.example.org", text: ARCHIVED_NOTICE }]);
  assert.equal(config.rooms[0].status, "archived");
  assert.ok(config.rooms[0].archived_at);
});

test("un workspace que vuelve a aparecer con el mismo id tiene sala nueva", async () => {
  const { manager, matrix, config } = setup();
  await manager.sync([workspace("w1", "api")]);
  await manager.sync([]);
  await manager.sync([workspace("w1", "api")]);

  assert.equal(matrix.calls.created.length, 2);
  assert.equal(config.rooms.filter((room) => room.status === "active").length, 1);
});

test("un fallo al crear una sala no impide crear las demás", async () => {
  const { manager, matrix, logs } = setup({ matrix: fakeMatrix({ failCreateFor: "api" }) });
  await manager.sync([workspace("w1", "api"), workspace("w2", "web")]);

  assert.deepEqual(matrix.calls.created.map((room) => room.name), ["web"]);
  assert.ok(logs.some((line) => line.includes("crear sala de api fallido")));
});

test("si el archivado falla, la sala sigue activa y se reintenta", async () => {
  const matrix = fakeMatrix();
  const { manager, config, logs } = setup({ matrix });
  await manager.sync([workspace("w1", "api")]);

  const getState = matrix.getState;
  matrix.getState = async () => null;
  await manager.sync([]);
  assert.equal(config.rooms[0].status, "active");
  assert.ok(logs.some((line) => line.includes("archivar sala de api fallido")));

  matrix.getState = getState;
  await manager.sync([]);
  assert.equal(config.rooms[0].status, "archived");
});
