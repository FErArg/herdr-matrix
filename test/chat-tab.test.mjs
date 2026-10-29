import { test } from "node:test";
import assert from "node:assert/strict";
import { agentOfWorkspace } from "../src/chat.mjs";

const agents = [
  { pane_id: "w4:p1", workspace_id: "w4", tab_id: "w4:t1", agent: "claude" },
  { pane_id: "w4:p2", workspace_id: "w4", tab_id: "w4:t2", agent: "claude" },
  { pane_id: "w9:p1", workspace_id: "w9", tab_id: "w9:t1", agent: "opencode" },
];

test("sin pestaña, un workspace con dos agentes sigue siendo ambiguo", () => {
  assert.throws(() => agentOfWorkspace(agents, "w4"), /más de un agente en el workspace/);
});

test("con pestaña, se elige el agente de esa pestaña aunque el workspace tenga varios", () => {
  assert.equal(agentOfWorkspace(agents, "w4", "w4:t2").pane_id, "w4:p2");
  assert.equal(agentOfWorkspace(agents, "w4", "w4:t1").pane_id, "w4:p1");
});

test("con pestaña sin agente devuelve null, sin tomar el de otra pestaña", () => {
  assert.equal(agentOfWorkspace(agents, "w4", "w4:t9"), null);
});

test("con pestaña, un agente de otro workspace nunca se elige", () => {
  assert.equal(agentOfWorkspace(agents, "w9", "w4:t1"), null);
});
