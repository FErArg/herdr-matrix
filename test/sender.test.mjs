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
