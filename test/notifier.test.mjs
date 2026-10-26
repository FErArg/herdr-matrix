import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, diffAgents, formatMessage, sanitize, snapshotOf } from "../src/notifier.mjs";

const agent = (overrides) => ({
  pane_id: "w1:p1",
  workspace_id: "w1",
  tab_id: "w1:t1",
  agent: "claude",
  agent_status: "idle",
  state_change_seq: 1,
  ...overrides,
});

test("sanitize quita controles y saltos de línea y limita longitud", () => {
  assert.equal(sanitize("a\nb\u0007  c"), "a b c");
  assert.equal(sanitize("x".repeat(500)).length, 200);
  assert.equal(sanitize(undefined), "");
});

test("diffAgents detecta agente nuevo, cambio de estado y panel desaparecido", () => {
  const before = snapshotOf([agent({ pane_id: "w1:p1" }), agent({ pane_id: "w2:p1", workspace_id: "w2", state_change_seq: 5 })]);
  const now = [
    agent({ pane_id: "w1:p1", agent_status: "blocked", state_change_seq: 2 }),
    agent({ pane_id: "w2:p1", workspace_id: "w2", state_change_seq: 5 }),
  ];
  assert.deepEqual(diffAgents(before, now).map((t) => [t.kind, t.agent.pane_id]), [["blocked", "w1:p1"]]);

  const gone = diffAgents(before, [now[1]]);
  assert.deepEqual(gone.map((t) => [t.kind, t.agent.pane_id]), [["exited", "w1:p1"]]);
});

test("diffAgents no repite estado sin cambio", () => {
  const list = [agent({ agent_status: "done", state_change_seq: 9 })];
  assert.deepEqual(diffAgents(snapshotOf(list), list), []);
});

test("de working a idle se avisa como done", () => {
  const before = snapshotOf([agent({ agent_status: "working", state_change_seq: 3 })]);
  const now = [agent({ agent_status: "idle", state_change_seq: 4 })];
  assert.deepEqual(diffAgents(before, now).map((t) => t.kind), ["done"]);
});

test("idle sin trabajo previo (agente nuevo o idle a idle) no se marca como done", () => {
  assert.deepEqual(diffAgents({}, [agent({ agent_status: "idle" })]).map((t) => t.kind), ["idle"]);
  const before = snapshotOf([agent({ agent_status: "idle", state_change_seq: 1 })]);
  assert.deepEqual(diffAgents(before, [agent({ agent_status: "idle", state_change_seq: 2 })]).map((t) => t.kind), ["idle"]);
});

test("formatMessage usa el formato [workspace/tab/panel] estado: texto", () => {
  const text = formatMessage({ label: "api", tabId: "w1:t1", paneId: "w1:p1", kind: "blocked", agent: "claude" });
  assert.equal(text, "[api/w1:t1/w1:p1] blocked: claude requiere atención");
  assert.ok(!text.includes("\n"));
});

test("rate limiter deja pasar una vez por ventana", () => {
  let current = 0;
  const limiter = createRateLimiter({ windowMs: 10_000, now: () => current });
  assert.equal(limiter.allow("w1:p1"), true);
  current = 5_000;
  assert.equal(limiter.allow("w1:p1"), false);
  assert.equal(limiter.allow("w2:p1"), true);
  current = 10_000;
  assert.equal(limiter.allow("w1:p1"), true);
});
