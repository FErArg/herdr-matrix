// Envío de mensajes a salas de Matrix.
// Regla: nunca se envía en claro a una sala cifrada. El SDK cifra con Megolm cuando la sala
// tiene m.room.encryption; si la sala no tiene cifrado activo, el envío se rechaza.

export function createRoomSender({ client }) {
  return {
    async sendText(roomId, text) {
      const encrypted = await client.getCrypto().isEncryptionEnabledInRoom(roomId);
      if (!encrypted) {
        throw new Error("la sala no está cifrada; no se envía");
      }
      const sent = await client.sendTextMessage(roomId, text);
      return sent.event_id;
    },
  };
}
