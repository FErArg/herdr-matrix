import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomSender } from "../src/sender.mjs";

// Cliente simulado con la forma que usa el remitente.
function fakeClient({ encrypted }) {
  const sent = [];
  return {
    sent,
    getCrypto: () => ({ isEncryptionEnabledInRoom: async () => encrypted }),
    sendTextMessage: async (roomId, body) => {
      sent.push({ roomId, body });
      return { event_id: "$evt1" };
    },
  };
}

test("envía a una sala cifrada y devuelve el event_id", async () => {
  const client = fakeClient({ encrypted: true });
  const eventId = await createRoomSender({ client }).sendText("!room:hs", "hola");
  assert.equal(eventId, "$evt1");
  assert.deepEqual(client.sent, [{ roomId: "!room:hs", body: "hola" }]);
});

test("no envía a una sala sin cifrado activo", async () => {
  const client = fakeClient({ encrypted: false });
  await assert.rejects(createRoomSender({ client }).sendText("!room:hs", "x"), /no está cifrada/);
  assert.deepEqual(client.sent, []);
});

test("editText reemplaza un mensaje propio con m.replace en sala cifrada", async () => {
  const sent = [];
  const client = {
    getCrypto: () => ({ isEncryptionEnabledInRoom: async () => true }),
    sendEvent: async (roomId, type, content) => {
      sent.push({ roomId, type, content });
      return { event_id: "$edit1" };
    },
  };
  const eventId = await createRoomSender({ client }).editText("!room:hs", "$orig", "nuevo texto");
  assert.equal(eventId, "$edit1");
  assert.equal(sent[0].type, "m.room.message");
  assert.deepEqual(sent[0].content["m.relates_to"], { rel_type: "m.replace", event_id: "$orig" });
  assert.equal(sent[0].content["m.new_content"].body, "nuevo texto");
});

test("editText no edita en una sala sin cifrado activo", async () => {
  const client = {
    getCrypto: () => ({ isEncryptionEnabledInRoom: async () => false }),
    sendEvent: async () => { throw new Error("no debería llamarse"); },
  };
  await assert.rejects(createRoomSender({ client }).editText("!room:hs", "$orig", "x"), /no está cifrada/);
});
