import { test } from "node:test";
import assert from "node:assert/strict";
import { createInviteQueue, INVITE_TIMEOUT_MS } from "../src/invites.mjs";

const CONTROL = "!control";
const EXISTING = "@ana:hs.example.org";

function harness({ existing = [EXISTING], failInvite = false } = {}) {
  let clock = 0;
  const sent = [];
  const invited = [];
  const logs = [];
  const matrix = {
    profileExists: async (mxid) => existing.includes(mxid),
    inviteUser: async (roomId, userId) => {
      if (failInvite) throw new Error("servidor caído");
      invited.push({ roomId, userId });
    },
  };
  const queue = createInviteQueue({
    matrix,
    sendText: async (roomId, text) => sent.push({ roomId, text }),
    controlRoomId: CONTROL,
    log: (line) => logs.push(line),
    now: () => clock,
  });
  return { queue, sent, invited, logs, advance: (ms) => { clock += ms; } };
}

test("enqueue pregunta en la sala de control por el workspace", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].roomId, CONTROL);
  assert.match(h.sent[0].text, /"api"/);
  assert.equal(h.queue.hasPending(), true);
});

test("\"no\" cierra la pregunta sin invitar a nadie", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  const reply = await h.queue.handle("no");
  assert.match(reply, /no se invita a nadie/);
  assert.equal(h.invited.length, 0);
  assert.equal(h.queue.hasPending(), false);
});

test("un MXID existente se invita a la sala del workspace", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  const reply = await h.queue.handle(EXISTING);
  assert.deepEqual(h.invited, [{ roomId: "!api", userId: EXISTING }]);
  assert.match(reply, /invitación enviada/);
  assert.equal(h.queue.hasPending(), false);
});

test("un MXID con formato inválido o inexistente mantiene la pregunta", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  assert.match(await h.queue.handle("@mal formato"), /no es válido/);
  assert.match(await h.queue.handle("@nadie:hs.example.org"), /no existe/);
  assert.equal(h.invited.length, 0);
  assert.equal(h.queue.hasPending(), true);
});

test("un texto que no es MXID ni \"no\" se trata como orden", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  assert.equal(await h.queue.handle("estado"), null);
  assert.equal(h.queue.hasPending(), true);
});

test("sin respuesta en 10 min la pregunta caduca y no se invita a nadie", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  h.advance(INVITE_TIMEOUT_MS + 1);
  assert.equal(await h.queue.handle(EXISTING), null);
  assert.equal(h.invited.length, 0);
  assert.equal(h.queue.hasPending(), false);
  assert.ok(h.logs.some((line) => line.includes("caducada")));
});

test("las preguntas se hacen una a una, en orden", async () => {
  const h = harness();
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  await h.queue.enqueue({ label: "web", roomId: "!web" });
  assert.equal(h.sent.length, 1);
  await h.queue.handle("no");
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].text, /"web"/);
});

test("un fallo al invitar cierra la pregunta y lo registra", async () => {
  const h = harness({ failInvite: true });
  await h.queue.enqueue({ label: "api", roomId: "!api" });
  const reply = await h.queue.handle(EXISTING);
  assert.match(reply, /no se pudo invitar/);
  assert.equal(h.queue.hasPending(), false);
});

test("la cola se guarda al cambiar y se recupera tras reiniciar", async () => {
  const saved = [];
  const queue = createInviteQueue({
    matrix: { profileExists: async () => true, inviteUser: async () => {} },
    sendText: async () => {},
    controlRoomId: CONTROL,
    log: () => {},
    persist: async (items) => saved.push(items),
  });
  await queue.enqueue({ label: "api", roomId: "!api" });
  await queue.enqueue({ label: "web", roomId: "!web" });
  assert.deepEqual(saved.at(-1), [{ label: "api", roomId: "!api" }, { label: "web", roomId: "!web" }]);

  const sent = [];
  const restarted = createInviteQueue({
    matrix: { profileExists: async () => true, inviteUser: async () => {} },
    sendText: async (roomId, text) => sent.push({ roomId, text }),
    controlRoomId: CONTROL,
    log: () => {},
    restore: saved.at(-1),
  });
  assert.equal(restarted.hasPending(), true);
  await restarted.resume();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /"api"/);
});

test("tras reiniciar, una respuesta contesta la pregunta recuperada", async () => {
  const invited = [];
  const queue = createInviteQueue({
    matrix: { profileExists: async () => true, inviteUser: async (roomId, userId) => invited.push({ roomId, userId }) },
    sendText: async () => {},
    controlRoomId: CONTROL,
    log: () => {},
    restore: [{ label: "api", roomId: "!api" }],
  });
  await queue.resume();
  assert.match(await queue.handle(EXISTING), /invitación enviada/);
  assert.deepEqual(invited, [{ roomId: "!api", userId: EXISTING }]);
});

test("las entradas guardadas sin sala o etiqueta se descartan al restaurar", () => {
  const queue = createInviteQueue({
    matrix: {},
    sendText: async () => {},
    controlRoomId: CONTROL,
    log: () => {},
    restore: [{ label: "api" }, { roomId: "!x" }, null],
  });
  assert.equal(queue.hasPending(), false);
});
