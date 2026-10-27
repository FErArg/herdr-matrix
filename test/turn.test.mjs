import { test } from "node:test";
import assert from "node:assert/strict";
import { requestText, transcriptPath, turnIn } from "../src/transcript.mjs";

const jsonl = (...entries) => entries.map((entry) => JSON.stringify(entry)).join("\n");
const userText = (text) => ({ type: "user", message: { role: "user", content: text } });
const assistantText = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const editTool = (path) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: path } }] },
});
const toolError = (text) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", is_error: true, content: text }] },
});

test("turnIn toma el pedido, la respuesta, los ficheros editados y los errores del último turno", () => {
  const log = jsonl(
    userText("primer pedido"),
    assistantText("respuesta vieja"),
    userText("añade tests"),
    editTool("/p/src/a.mjs"),
    toolError("prueba fallida"),
    editTool("/p/src/a.mjs"),
    editTool("/p/src/b.mjs"),
    assistantText("Listo."),
  );
  assert.deepEqual(turnIn(log), {
    request: "añade tests",
    reply: "Listo.",
    files: ["/p/src/a.mjs", "/p/src/b.mjs"],
    problems: ["prueba fallida"],
    actions: [
      { name: "Edit", detail: "/p/src/a.mjs" },
      { name: "Edit", detail: "/p/src/a.mjs" },
      { name: "Edit", detail: "/p/src/b.mjs" },
    ],
  });
});

test("turnIn sin pedido ni respuesta devuelve nulos y listas vacías", () => {
  assert.deepEqual(turnIn(""), { request: null, reply: null, files: [], problems: [], actions: [] });
});

test("turnIn ignora herramientas que no cambian ficheros", () => {
  const read = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/p/x" } }] } };
  const result = turnIn(jsonl(userText("pedido"), read, assistantText("ok")));
  assert.deepEqual(result.files, []);
});

test("transcriptPath rechaza ids de sesión con caracteres de ruta", () => {
  assert.throws(() => transcriptPath("/p", "../../etc/passwd", "/home/u"), /id de sesión no válido/);
  assert.throws(() => transcriptPath("/p", "a/b", "/home/u"), /id de sesión no válido/);
  assert.throws(() => transcriptPath("/p", "", "/home/u"), /id de sesión no válido/);
});

test("transcriptPath acepta un UUID de Claude Code", () => {
  const path = transcriptPath("/Users/u/proy", "1f2e3d4c-aaaa-bbbb-cccc-0123456789ab", "/home/u");
  assert.equal(path, "/home/u/.claude/projects/-Users-u-proy/1f2e3d4c-aaaa-bbbb-cccc-0123456789ab.jsonl");
});

test("turnIn lista las herramientas usadas con su dato más útil", () => {
  const bash = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } };
  const grep = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }] } };
  const result = turnIn(jsonl(userText("pedido"), bash, grep, assistantText("ok")));
  assert.deepEqual(result.actions, [{ name: "Bash", detail: "npm test" }, { name: "Grep", detail: "foo" }]);
});

test("requestText quita las etiquetas de una orden con barra y conserva nombre y argumentos", () => {
  assert.equal(requestText("<command-message>commit-push</command-message>\n<command-name>/commit-push</command-name>"), "/commit-push");
  assert.equal(requestText("<command-name>/crear-plan</command-name><command-args>plan.md</command-args>"), "/crear-plan plan.md");
  assert.equal(requestText("añade tests"), "añade tests");
});

test("turnIn usa el pedido sin etiquetas cuando el turno empieza con una orden con barra", () => {
  const command = userText("<command-message>commit-push</command-message>\n<command-name>/commit-push</command-name>");
  assert.equal(turnIn(jsonl(command, assistantText("Hecho."))).request, "/commit-push");
});
