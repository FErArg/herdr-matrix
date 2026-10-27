import { test } from "node:test";
import assert from "node:assert/strict";
import { createCards } from "../src/cards.mjs";

const ROOM = "!api:hs.example.org";

function fakeSender({ editFails = 0 } = {}) {
  const sent = [];
  const edits = [];
  let failures = editFails;
  let counter = 0;
  return {
    sent,
    edits,
    sendText: async (roomId, text) => {
      counter++;
      sent.push({ roomId, text, eventId: `$e${counter}` });
      return `$e${counter}`;
    },
    editText: async (roomId, eventId, text) => {
      if (failures > 0) {
        failures--;
        throw new Error("edición rechazada");
      }
      edits.push({ roomId, eventId, text });
      return "$edit";
    },
  };
}

function setup(options = {}) {
  const sender = fakeSender(options);
  const persisted = [];
  const logged = [];
  const cards = createCards({
    sender,
    persist: async (items) => { persisted.push(items); },
    log: (line) => logged.push(line),
  });
  return { sender, cards, persisted, logged };
}

test("open envía la tarjeta de apertura y la guarda con su event_id", async () => {
  const { sender, cards, persisted } = setup();
  const opened = await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "añade tests" });
  assert.equal(opened, true);
  assert.equal(sender.sent[0].text, "Tarea: añade tests\nEstado: trabajando");
  assert.equal(cards.get("w1:p1").eventId, "$e1");
  assert.equal(persisted.at(-1)[0].roomId, ROOM);
});

test("un segundo open en el mismo panel no envía otra tarjeta: vuelve a trabajando", async () => {
  const { sender, cards } = setup();
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  await cards.decide({ paneId: "w1:p1", lines: "¿Permitir? 1) Sí 2) No" });
  const opened = await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "otra" });
  assert.equal(opened, false);
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.edits.at(-1).text, "Tarea: t\nEstado: trabajando");
});

test("decide edita la misma tarjeta con la decisión pendiente", async () => {
  const { sender, cards } = setup();
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  assert.equal(await cards.decide({ paneId: "w1:p1", lines: "¿Permitir? 1) Sí" }), true);
  assert.equal(sender.edits[0].eventId, "$e1");
  assert.match(sender.edits[0].text, /Estado: necesita decisión\n¿Permitir\? 1\) Sí/);
});

test("close edita la tarjeta con el resultado y la retira", async () => {
  const { sender, cards } = setup();
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  const turn = { reply: "Hecho.", files: ["a.mjs"], problems: [] };
  assert.equal(await cards.close({ paneId: "w1:p1", kind: "done", turn }), true);
  assert.equal(sender.edits.at(-1).text, "Tarea: t\nEstado: terminó\nHecho: Hecho.\nCambios: a.mjs\nProblemas: ninguno");
  assert.equal(cards.get("w1:p1"), null);
});

test("close sin tarjeta abierta no hace nada", async () => {
  const { sender, cards } = setup();
  assert.equal(await cards.close({ paneId: "w9:p1", kind: "done", turn: null }), false);
  assert.deepEqual(sender.edits, []);
});

test("si la edición falla dos veces, el cierre va en un mensaje nuevo", async () => {
  const { sender, cards, logged } = setup({ editFails: 2 });
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  await cards.close({ paneId: "w1:p1", kind: "done", turn: null });
  assert.equal(sender.sent.at(-1).text, "Cierre no actualizado: terminó");
  assert.equal(logged.length, 2);
  assert.equal(cards.get("w1:p1"), null);
});

test("un reintento que funciona no envía mensaje de respaldo", async () => {
  const { sender, cards } = setup({ editFails: 1 });
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  await cards.close({ paneId: "w1:p1", kind: "done", turn: null });
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.edits.length, 1);
});

test("tras reiniciar, las tarjetas abiertas se cierran como interrumpidas", async () => {
  const restored = [{ paneId: "w1:p1", workspaceId: "w1", roomId: ROOM, eventId: "$old", task: "t" }];
  const sender = fakeSender();
  const cards = createCards({ sender, persist: async () => {}, restore: restored, log: () => {} });
  await cards.recoverInterrupted();
  assert.deepEqual(sender.edits, [{ roomId: ROOM, eventId: "$old", text: "Tarea: t\nEstado: interrumpida" }]);
  assert.deepEqual(cards.all(), []);
});

test("una tarjeta se edita solo en la sala donde se abrió", async () => {
  const { sender, cards } = setup();
  await cards.open({ roomId: ROOM, workspaceId: "w1", paneId: "w1:p1", task: "t" });
  await cards.decide({ paneId: "w1:p1", lines: "x" });
  assert.ok(sender.edits.every((edit) => edit.roomId === ROOM));
  assert.equal(cards.get("w2:p1"), null);
});
