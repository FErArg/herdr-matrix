import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabRoomManager, slugify, tabRoomName } from "../src/tab-rooms.mjs";
import { ARCHIVED_NOTICE, ROOM_STATE_TYPE } from "../src/rooms.mjs";
import { routeRoom } from "../src/outbound.mjs";

const OWNER = "@owner:hs.example.org";

function fakeMatrix() {
  let counter = 0;
  const calls = { created: [], state: [] };
  const levels = new Map();
  return {
    calls,
    createEncryptedRoom: async ({ name, invite }) => {
      counter++;
      const roomId = `!tab${counter}:hs.example.org`;
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

function setup() {
  const matrix = fakeMatrix();
  const sent = [];
  const saved = [];
  const logs = [];
  const clock = { at: 0 };
  const config = { config_version: 1, owner: OWNER, rooms: [], tab_rooms: [] };
  const manager = createTabRoomManager({
    matrix,
    sendText: async (roomId, text) => sent.push({ roomId, text }),
    config,
    saveConfig: async (data) => saved.push(JSON.parse(JSON.stringify(data))),
    log: (text) => logs.push(text),
    now: () => clock.at,
    sleep: async () => {},
  });
  return { matrix, sent, saved, logs, config, manager, clock };
}

const tab = (overrides = {}) => ({
  tab_id: "w1:t2",
  label: "rama beta",
  workspace_id: "w1",
  workspace_label: "herdr-matrix",
  ...overrides,
});

test("slugify deja minúsculas, sin acentos y con guiones", () => {
  assert.equal(slugify("Rama Beta"), "rama-beta");
  assert.equal(slugify("  Año_nuevo!! "), "ano-nuevo");
  assert.equal(slugify("---"), "");
});

test("tabRoomName une workspace y pestaña; sin caracteres válidos en la etiqueta usa el número de pestaña", () => {
  assert.equal(tabRoomName("herdr-matrix", "rama beta", 2), "herdr-matrix-rama-beta");
  assert.equal(tabRoomName("herdr-matrix", "分支", 2), "herdr-matrix-2");
  assert.equal(tabRoomName("herdr-matrix", "!!!", 0), "herdr-matrix-0");
  assert.equal(tabRoomName("!!!", "!!!", 3), "3");
  assert.equal(tabRoomName("!!!", "!!!"), "pestana");
});

test("el nombre de la sala usa el número de pestaña si la etiqueta no tiene caracteres válidos", async () => {
  const { matrix, manager } = setup();
  await manager.sync([tab({ label: "分支", number: 4 })]);
  assert.equal(matrix.calls.created[0].name, "herdr-matrix-4");
});

test("crea una sala cifrada por pestaña nueva, invita al dueño y guarda el mapeo", async () => {
  const { matrix, saved, config, manager } = setup();
  await manager.sync([tab()]);

  assert.equal(matrix.calls.created.length, 1);
  const [created] = matrix.calls.created;
  assert.equal(created.name, "herdr-matrix-rama-beta");
  assert.deepEqual(created.invite, [OWNER]);
  assert.deepEqual(config.tab_rooms, [
    {
      tab_id: "w1:t2",
      workspace_id: "w1",
      label: "rama beta",
      name: "herdr-matrix-rama-beta",
      room_id: created.roomId,
      status: "active",
    },
  ]);
  assert.ok(saved.length >= 1);
  const stateTypes = matrix.calls.state.map((item) => item.type);
  assert.ok(stateTypes.includes(ROOM_STATE_TYPE));
  assert.ok(stateTypes.includes("m.room.topic"));
});

test("una segunda reconciliación sin cambios no crea salas repetidas", async () => {
  const { matrix, manager } = setup();
  await manager.sync([tab()]);
  await manager.sync([tab()]);
  assert.equal(matrix.calls.created.length, 1);
});

test("renombra la sala cuando cambia la etiqueta de la pestaña o del workspace", async () => {
  const { matrix, config, manager } = setup();
  await manager.sync([tab()]);
  await manager.sync([tab({ label: "rama gamma" })]);
  await manager.sync([tab({ label: "rama gamma", workspace_label: "herdr-nuevo" })]);

  const renames = matrix.calls.state.filter((item) => item.type === "m.room.name");
  assert.deepEqual(renames.map((item) => item.content.name), ["herdr-matrix-rama-gamma", "herdr-nuevo-rama-gamma"]);
  assert.equal(config.tab_rooms[0].name, "herdr-nuevo-rama-gamma");
});

test("archiva la sala cuando la pestaña desaparece, sin borrarla", async () => {
  const { matrix, sent, config, manager } = setup();
  await manager.sync([tab()]);
  const roomId = config.tab_rooms[0].room_id;
  await manager.sync([]);

  assert.equal(config.tab_rooms[0].status, "archived");
  assert.ok(config.tab_rooms[0].archived_at);
  assert.equal(sent.at(-1).roomId, roomId);
  assert.equal(sent.at(-1).text, ARCHIVED_NOTICE);
  const levels = matrix.calls.state.find((item) => item.type === "m.room.power_levels");
  assert.equal(levels.content.events_default, 100);
});

test("una pestaña nueva con el mismo nombre que una archivada crea sala nueva", async () => {
  const { matrix, config, manager } = setup();
  await manager.sync([tab()]);
  await manager.sync([]);
  await manager.sync([tab({ tab_id: "w1:t9" })]);

  assert.equal(matrix.calls.created.length, 2);
  assert.equal(config.tab_rooms.filter((room) => room.status === "active").length, 1);
});

test("un 429 pausa la sincronización y no crea más salas hasta que pasa la pausa", async () => {
  const { matrix, logs, config, manager, clock } = setup();
  let limited = true;
  const original = matrix.createEncryptedRoom;
  matrix.createEncryptedRoom = async (args) => {
    if (limited) throw Object.assign(new Error("Too Many Requests"), { status: 429 });
    return original(args);
  };
  const tabs = [tab(), tab({ tab_id: "w1:t3", label: "rama gamma" })];

  await manager.sync(tabs);
  assert.equal(config.tab_rooms.length, 0);
  assert.equal(matrix.calls.created.length, 0);
  assert.ok(logs.some((line) => line.includes("pausado")));

  clock.at += 30_000;
  limited = false;
  await manager.sync(tabs);
  assert.equal(config.tab_rooms.length, 0, "dentro de la pausa no se intenta nada");

  clock.at += 60_000;
  await manager.sync(tabs);
  assert.equal(config.tab_rooms.length, 2);
  assert.deepEqual(
    config.tab_rooms.map((room) => room.name),
    ["herdr-matrix-rama-beta", "herdr-matrix-rama-gamma"],
  );
});

test("un fallo al crear una sala no detiene las demás pestañas", async () => {
  const { matrix, logs, config, manager } = setup();
  const original = matrix.createEncryptedRoom;
  matrix.createEncryptedRoom = async (args) => {
    if (args.name === "herdr-matrix-rama-beta") throw new Error("servidor no disponible");
    return original(args);
  };
  await manager.sync([tab(), tab({ tab_id: "w1:t3", label: "rama gamma" })]);

  assert.equal(config.tab_rooms.length, 1);
  assert.equal(config.tab_rooms[0].name, "herdr-matrix-rama-gamma");
  assert.ok(logs.some((line) => line.includes("crear sala de la pestaña herdr-matrix-rama-beta fallido")));
});

test("routeRoom envía a la sala de la pestaña y, sin ella, a la del workspace", () => {
  const config = {
    rooms: [{ workspace_id: "w1", room_id: "!ws:hs", status: "active" }],
    tab_rooms: [
      { workspace_id: "w1", tab_id: "w1:t2", room_id: "!tab:hs", status: "active" },
      { workspace_id: "w1", tab_id: "w1:t3", room_id: "!old:hs", status: "archived" },
    ],
  };
  assert.equal(routeRoom(config, "w1", "w1:t2"), "!tab:hs");
  assert.equal(routeRoom(config, "w1", "w1:t3"), "!ws:hs");
  assert.equal(routeRoom(config, "w1", "w1:t9"), "!ws:hs");
  assert.equal(routeRoom(config, "w1"), "!ws:hs");
});
