// Envío de mensajes a salas de Matrix.
// Regla: nunca se envía en claro a una sala cifrada. El SDK cifra con Megolm cuando la sala
// tiene m.room.encryption; si la sala no tiene cifrado activo, el envío se rechaza.

export function createRoomSender({ client }) {
  async function assertEncrypted(roomId) {
    const encrypted = await client.getCrypto().isEncryptionEnabledInRoom(roomId);
    if (!encrypted) {
      throw new Error("la sala no está cifrada; no se envía");
    }
  }

  return {
    async sendText(roomId, text) {
      await assertEncrypted(roomId);
      const sent = await client.sendTextMessage(roomId, text);
      return sent.event_id;
    },

    // Reemplaza un mensaje propio (m.replace). Element muestra solo el texto nuevo (validado en el paso 0).
    async editText(roomId, eventId, text) {
      await assertEncrypted(roomId);
      const sent = await client.sendEvent(roomId, "m.room.message", {
        msgtype: "m.text",
        body: `* ${text}`,
        "m.new_content": { msgtype: "m.text", body: text },
        "m.relates_to": { rel_type: "m.replace", event_id: eventId },
      });
      return sent.event_id;
    },
  };
}
