import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, closeStateOf, closeText, decisionText, interruptedText, LIMITS, openText, redact, safe } from "../src/card.mjs";

test("clip colapsa espacios y recorta con puntos suspensivos", () => {
  assert.equal(clip("a\n\n  b", 10), "a b");
  assert.equal(clip("x".repeat(20), 5), "xxxxx…");
});

test("redact oculta cabeceras, prefijos conocidos y asignaciones sensibles", () => {
  assert.equal(redact("Authorization: Bearer abc123"), "[oculto]");
  assert.equal(redact("usa sk-abcdef123456 para probar"), "usa [oculto] para probar");
  assert.equal(redact("export API_KEY=supersecreto"), "export API_KEY=[oculto]");
  assert.equal(redact("DB_PASSWORD=x y MODE=dev"), "DB_PASSWORD=[oculto] y MODE=dev");
});

test("safe aplica redacción y recorte", () => {
  assert.equal(safe("token ghp_abcdefghij y más", 100), "token [oculto] y más");
});

test("openText muestra la tarea recortada y el estado trabajando", () => {
  const text = openText({ task: "x".repeat(300) });
  const [task, state] = text.split("\n");
  assert.equal(task.length, "Tarea: ".length + LIMITS.task + 1);
  assert.equal(state, "Estado: trabajando");
});

test("openText sin tarea usa no disponible", () => {
  assert.equal(openText({ task: null }), "Tarea: no disponible\nEstado: trabajando");
});

test("closeStateOf distingue terminó, error y sin resultado", () => {
  assert.equal(closeStateOf({ turn: { reply: "hecho", problems: [] }, kind: "done" }), "terminó");
  assert.equal(closeStateOf({ turn: { reply: null, problems: ["fallo"] }, kind: "done" }), "error");
  assert.equal(closeStateOf({ turn: { reply: null, problems: [] }, kind: "done" }), "sin resultado");
  assert.equal(closeStateOf({ turn: null, kind: "done" }), "terminó");
  assert.equal(closeStateOf({ turn: { reply: "x", problems: [] }, kind: "exited" }), "sin resultado");
});

test("closeText incluye hecho, cambios y problemas", () => {
  const text = closeText({
    task: "añade tests",
    state: "terminó",
    turn: { reply: "Listo.", files: ["src/a.mjs", "src/b.mjs"], problems: [] },
  });
  assert.equal(text, "Tarea: añade tests\nEstado: terminó\nHecho: Listo.\nCambios: src/a.mjs, src/b.mjs\nProblemas: ninguno");
});

test("closeText limita ficheros y problemas y dice cuántos se omiten", () => {
  const files = Array.from({ length: 12 }, (_, i) => `f${i}.mjs`);
  const problems = ["e1", "e2", "e3", "e4", "e5"];
  const text = closeText({ task: "t", state: "error", turn: { reply: null, files, problems } });
  assert.match(text, /Cambios: f0\.mjs, .* … y 2 más/);
  assert.match(text, /Problemas: e1, e2, e3 … y 2 más/);
});

test("closeText sin lectura de transcripción y con cambios no disponibles", () => {
  assert.equal(closeText({ task: "t", state: "terminó", turn: null }), "Tarea: t\nEstado: terminó\nDetalle no disponible");
  const text = closeText({ task: "t", state: "terminó", turn: { reply: "ok", files: null, problems: [] } });
  assert.match(text, /Cambios: no disponible/);
});

test("decisionText muestra las últimas líneas del panel y la orden de respuesta", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `línea ${i}`).join("\n");
  const text = decisionText({ task: "t", panelLines: lines });
  const parts = text.split("\n");
  assert.equal(parts[1], "Estado: necesita decisión");
  assert.equal(parts.length, 2 + LIMITS.panel);
  assert.equal(parts.at(-1), "línea 29");
});

test("interruptedText marca la tarea como interrumpida", () => {
  assert.equal(interruptedText({ task: "t" }), "Tarea: t\nEstado: interrumpida");
});
