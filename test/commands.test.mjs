import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, isConfirmation, MAX_TEXT_LENGTH, normalizeBody, paneWorkspace, parseCommand } from "../src/commands.mjs";

test("la tabla fija el método de Herdr de cada verbo", () => {
  assert.equal(COMMANDS.estado.method, "agent.list");
  assert.equal(COMMANDS.leer.method, "pane.read");
  assert.equal(COMMANDS.enviar.method, "pane.send_text");
  assert.equal(COMMANDS.enter.method, "pane.send_keys");
  assert.equal(COMMANDS.enviar.confirm, true);
});

test("estado no admite argumentos y leer exige un panel válido", () => {
  assert.deepEqual(parseCommand("estado"), { verb: "estado", args: {} });
  assert.deepEqual(parseCommand("ESTADO"), { verb: "estado", args: {} });
  assert.deepEqual(parseCommand("leer w1:p2"), { verb: "leer", args: { pane: "w1:p2" } });
  assert.match(parseCommand("estado extra").error, /no admite argumentos/);
  assert.match(parseCommand("leer panel1").error, /identificador de panel/);
  assert.match(parseCommand("leer").error, /identificador de panel/);
});

test("enviar toma todo lo que sigue al panel como texto", () => {
  assert.deepEqual(parseCommand("enviar w1:p1 hola   mundo"), {
    verb: "enviar",
    args: { pane: "w1:p1", text: "hola mundo" },
  });
  assert.match(parseCommand("enviar w1:p1").error, /falta el texto/);
});

test("enter solo admite el panel", () => {
  assert.deepEqual(parseCommand("enter w1:p1"), { verb: "enter", args: { pane: "w1:p1" } });
  assert.match(parseCommand("enter w1:p1 y").error, /solo admite el panel/);
});

test("verbos fuera de la tabla, cuerpos vacíos y caracteres de control se rechazan", () => {
  assert.equal(parseCommand("borrar w1:p1").error, "orden no reconocida");
  assert.match(parseCommand("").error, /vacía/);
  assert.match(parseCommand("enviar w1:p1 linea\nsegunda").error, /caracteres de control/);
});

test("el texto de enviar tiene límite de longitud", () => {
  const long = "a".repeat(MAX_TEXT_LENGTH + 1);
  assert.match(parseCommand(`enviar w1:p1 ${long}`).error, /supera/);
  assert.equal(parseCommand(`enviar w1:p1 ${"a".repeat(MAX_TEXT_LENGTH)}`).verb, "enviar");
});

test("el workspace de un panel es el prefijo de su id", () => {
  assert.equal(paneWorkspace("w12:p3"), "w12");
});

test("la puntuación final y los caracteres invisibles no cambian la orden", () => {
  assert.deepEqual(parseCommand("leer w2:p1."), { verb: "leer", args: { pane: "w2:p1" } });
  assert.deepEqual(parseCommand("enviar​ w2:p1 prueba de escritura"), {
    verb: "enviar",
    args: { pane: "w2:p1", text: "prueba de escritura" },
  });
  assert.equal(normalizeBody("Confirmar,"), "Confirmar");
});

test("un verbo desconocido devuelve su primera palabra para la auditoría", () => {
  assert.deepEqual(parseCommand("borrar todo"), { error: "orden no reconocida", word: "borrar" });
});

test("sinónimos y tildes se interpretan como el verbo de la tabla", () => {
  assert.deepEqual(parseCommand("Envía w2:p1 hola"), { verb: "enviar", args: { pane: "w2:p1", text: "hola" } });
  assert.deepEqual(parseCommand("lee w2:p1"), { verb: "leer", args: { pane: "w2:p1" } });
  assert.deepEqual(parseCommand("status"), { verb: "estado", args: {} });
  assert.deepEqual(parseCommand("intro w2:p1"), { verb: "enter", args: { pane: "w2:p1" } });
});

test("una letra de error se tolera en lectura, pero no en escritura", () => {
  assert.deepEqual(parseCommand("estdo"), { verb: "estado", args: {} });
  assert.equal(parseCommand("leeer w2:p1").error, "orden no reconocida"); // las palabras de 4 letras no admiten errata
  assert.equal(parseCommand("enviat w2:p1 hola").error, "orden no reconocida");
  assert.equal(parseCommand("entre w2:p1").error, "orden no reconocida");
});

test("el panel acepta mayúsculas, punto o espacio como separador", () => {
  assert.deepEqual(parseCommand("leer W2:P1"), { verb: "leer", args: { pane: "w2:p1" } });
  assert.deepEqual(parseCommand("leer w2.p1"), { verb: "leer", args: { pane: "w2:p1" } });
  assert.deepEqual(parseCommand("leer w2 p1"), { verb: "leer", args: { pane: "w2:p1" } });
});

test("palabras que no son verbos ni sinónimos se rechazan", () => {
  assert.equal(parseCommand("mostrarme todo").error, "orden no reconocida");
  assert.equal(parseCommand("hola").error, "orden no reconocida");
});

test("las confirmaciones aceptan variantes sin tildes ni puntuación", () => {
  assert.equal(isConfirmation("Confirmar,"), true);
  assert.equal(isConfirmation("sí"), true);
  assert.equal(isConfirmation("ok"), true);
  assert.equal(isConfirmation("confirmar w2:p1"), false);
  assert.equal(isConfirmation("no"), false);
});
