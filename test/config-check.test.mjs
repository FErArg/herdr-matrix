import { test } from "node:test";
import assert from "node:assert/strict";
import { assertConfigValid, configProblems } from "../src/config-check.mjs";

const valid = () => ({
  config_version: 1,
  url: "https://synapse.example.org:8448",
  owner: "@owner:synapse.example.org",
  control_room_id: "!control",
  rooms: [
    { workspace_id: "w1", label: "api", room_id: "!api", status: "active" },
    { workspace_id: "w2", label: "old", room_id: "!old", status: "archived" },
  ],
  notify_events: ["blocked", "done", "exited"],
  allowed_panes: {},
});

test("una configuración correcta no tiene problemas", () => {
  assert.deepEqual(configProblems(valid()), []);
  assert.doesNotThrow(() => assertConfigValid(valid()));
});

test("URL http, owner mal formado y sala de control inválida se señalan", () => {
  const config = valid();
  config.url = "http://synapse.example.org";
  config.owner = "owner";
  config.control_room_id = "control";
  const problems = configProblems(config).join("\n");
  assert.match(problems, /url: Solo se acepta https/);
  assert.match(problems, /owner: El MXID/);
  assert.match(problems, /control_room_id/);
});

test("rooms con workspace, sala o estado inválidos se señalan por índice", () => {
  const config = valid();
  config.rooms = [
    { workspace_id: "api", room_id: "!x", status: "active" },
    { workspace_id: "w3", room_id: "no room", status: "borrada" },
  ];
  const problems = configProblems(config);
  assert.ok(problems.some((p) => p.startsWith("rooms[0].workspace_id")));
  assert.ok(problems.some((p) => p.startsWith("rooms[1].room_id")));
  assert.ok(problems.some((p) => p.startsWith("rooms[1].status")));
});

test("los ids de workspace de Herdr con letras (wA, wB) son válidos", () => {
  const config = valid();
  config.rooms.push({ workspace_id: "wA", label: "proyecto-ejemplo", room_id: "!voice", status: "active" });
  assert.deepEqual(configProblems(config), []);
});

test("notify_events con tipos desconocidos se señala", () => {
  const config = valid();
  config.notify_events = ["blocked", "borrar"];
  assert.match(configProblems(config).join("\n"), /tipo desconocido: borrar/);
});

test("config_version distinto o config vacía se rechazan", () => {
  const config = valid();
  config.config_version = 2;
  assert.match(configProblems(config).join("\n"), /config_version/);
  assert.deepEqual(configProblems(null), ["config.json no es un objeto"]);
});

test("assertConfigValid lanza un error fatal", () => {
  const config = valid();
  config.owner = "nadie";
  assert.throws(() => assertConfigValid(config), (error) => error.fatal === true && /config.json no es válido/.test(error.message));
});

test("chat.opencode_auto debe ser booleano", () => {
  const config = valid();
  config.chat = { opencode_auto: "si" };
  assert.match(configProblems(config).join("\n"), /opencode_auto debe ser true o false/);
  config.chat = { opencode_auto: false };
  assert.deepEqual(configProblems(config), []);
});
