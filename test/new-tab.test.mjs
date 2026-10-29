import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, NEW_TAB_KINDS, parseCommand } from "../src/commands.mjs";
import { agentNameOf, choiceOf, createNewTab, NEW_TAB_LIMIT } from "../src/new-tab.mjs";

// Falso de Herdr: registra cada petición y responde según el método.
function fakeHerdr({ agents = [], failStart = false, failCreate = false } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push({ method, params });
      if (method === "agent.list") return { agents };
      if (method === "tab.create") {
        if (failCreate) throw new Error("tab.create falló");
        return { tab: { tab_id: "w4:t9", label: "pestaña 9" }, root_pane: { pane_id: "w4:p9" } };
      }
      if (method === "agent.start") {
        if (failStart) throw new Error("tiempo agotado");
        return { agent: { pane_id: "w4:p9" } };
      }
      throw new Error(`método inesperado ${method}`);
    },
  };
}

const withAgent = [{ pane_id: "w4:p1", workspace_id: "w4", tab_id: "w4:t1", agent: "claude", cwd: "/proyecto" }];

test("la orden new-tab es de escritura con confirmación y admite un tipo opcional", () => {
  assert.equal(COMMANDS["new-tab"].method, "tab.create");
  assert.equal(COMMANDS["new-tab"].write, true);
  assert.equal(COMMANDS["new-tab"].confirm, true);
  assert.deepEqual(NEW_TAB_KINDS, ["claude", "opencode"]);
});

test("parseCommand: new-tab sin tipo, con tipo válido, con tipo desconocido o con argumentos de más", () => {
  assert.deepEqual(parseCommand("new-tab"), { verb: "new-tab", args: {} });
  assert.deepEqual(parseCommand("new-tab opencode"), { verb: "new-tab", args: { kind: "opencode" } });
  assert.deepEqual(parseCommand("NEW-TAB Claude"), { verb: "new-tab", args: { kind: "claude" } });
  assert.match(parseCommand("new-tab vim").error, /tipo de agente no válido/);
  assert.match(parseCommand("new-tab claude extra").error, /como máximo un tipo/);
});

test("sin agente en el workspace no crea pestaña y lo dice", async () => {
  const herdr = fakeHerdr({ agents: [] });
  const text = await createNewTab({ herdr }).run({ workspaceId: "w4" });
  assert.match(text, /no hay ningún agente abierto/);
  assert.equal(herdr.calls.some((call) => call.method === "tab.create"), false);
});

test("sin tipo crea la pestaña con el cwd de un agente del workspace y no arranca agente", async () => {
  const herdr = fakeHerdr({ agents: withAgent });
  const text = await createNewTab({ herdr }).run({ workspaceId: "w4" });
  const create = herdr.calls.find((call) => call.method === "tab.create");
  assert.deepEqual(create.params, { workspace_id: "w4", cwd: "/proyecto", focus: false });
  assert.equal(herdr.calls.some((call) => call.method === "agent.start"), false);
  assert.match(text, /pestaña w4:t9 creada/);
});

test("con tipo arranca el agente en el panel raíz de la pestaña nueva", async () => {
  const herdr = fakeHerdr({ agents: withAgent });
  const text = await createNewTab({ herdr }).run({ workspaceId: "w4", kind: "opencode" });
  const start = herdr.calls.find((call) => call.method === "agent.start");
  assert.equal(start.params.kind, "opencode");
  assert.equal(start.params.pane_id, "w4:p9");
  assert.equal(start.params.name, "nueva-w4-t9");
  assert.match(text, /creada con opencode/);
});

test("si el agente no arranca, la pestaña queda abierta y se informa del error", async () => {
  const herdr = fakeHerdr({ agents: withAgent, failStart: true });
  const text = await createNewTab({ herdr }).run({ workspaceId: "w4", kind: "claude" });
  assert.equal(herdr.calls.some((call) => call.method === "tab.close"), false);
  assert.match(text, /pestaña w4:t9 creada, pero no se pudo arrancar claude: tiempo agotado/);
});

test("un fallo de tab.create se propaga para que la orden quede en auditoría como error", async () => {
  const herdr = fakeHerdr({ agents: withAgent, failCreate: true });
  await assert.rejects(createNewTab({ herdr }).run({ workspaceId: "w4" }), /tab\.create falló/);
});

test("máximo tres pestañas por workspace en diez minutos; la cuarta se rechaza sin tocar Herdr", async () => {
  let current = 0;
  const herdr = fakeHerdr({ agents: withAgent });
  const newTab = createNewTab({ herdr, now: () => current });
  for (let i = 0; i < NEW_TAB_LIMIT.max; i++) {
    assert.match(await newTab.run({ workspaceId: "w4" }), /pestaña w4:t9 creada/);
  }
  const creates = () => herdr.calls.filter((call) => call.method === "tab.create").length;
  const before = creates();
  assert.match(await newTab.run({ workspaceId: "w4" }), /demasiadas pestañas nuevas/);
  assert.equal(creates(), before);
  current = NEW_TAB_LIMIT.windowMs + 1;
  assert.match(await newTab.run({ workspaceId: "w4" }), /pestaña w4:t9 creada/);
});

test("el límite es por workspace: otro workspace no se ve afectado", async () => {
  const herdr = fakeHerdr({ agents: [...withAgent, { pane_id: "wK:p1", workspace_id: "wK", agent: "claude", cwd: "/otro" }] });
  const newTab = createNewTab({ herdr, now: () => 0 });
  for (let i = 0; i < NEW_TAB_LIMIT.max; i++) await newTab.run({ workspaceId: "w4" });
  assert.match(await newTab.run({ workspaceId: "wK" }), /pestaña w4:t9 creada/);
});

test("el nombre del agente cumple las reglas de Herdr aunque el ID de pestaña tenga dos puntos o mayúsculas", () => {
  assert.equal(agentNameOf("w4:tC"), "nueva-w4-tc");
  assert.match(agentNameOf("w12:t3"), /^[a-z0-9_-]{1,32}$/);
  assert.equal(agentNameOf("w4:t9").length <= 32, true);
});

test("la elección de agente acepta número o nombre; confirmar no elige nada", () => {
  assert.deepEqual(choiceOf("1"), { kind: "opencode" });
  assert.deepEqual(choiceOf("Opencode"), { kind: "opencode" });
  assert.deepEqual(choiceOf("2"), { kind: "claude" });
  assert.deepEqual(choiceOf("claude."), { kind: "claude" });
  assert.deepEqual(choiceOf("3"), { kind: null });
  assert.deepEqual(choiceOf("solo pestaña"), { kind: null });
  assert.equal(choiceOf("cancelar"), "cancel");
  assert.equal(choiceOf("confirmar"), "hint");
  assert.equal(choiceOf("hola"), null);
});
