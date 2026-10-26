// Conecta el cliente del SDK con src/inbound.mjs. Solo mensajes de texto (m.text).
// En salas cifradas, el evento llega primero cifrado y luego se descifra (Decrypted): solo se
// procesa el evento ya descifrado. El Timeline en vivo cubre los mensajes en claro.

import * as sdk from "matrix-js-sdk";

export function toMessage(event) {
  if (event.getType() !== "m.room.message") return null;
  const content = event.getContent();
  if (content.msgtype !== "m.text") return null;
  return {
    eventId: event.getId(),
    roomId: event.getRoomId(),
    sender: event.getSender(),
    body: content.body,
    ts: event.getTs(),
  };
}

// Devuelve una función que quita los listeners.
export function attachInbound(client, inbound) {
  const dispatch = (event) => {
    const message = toMessage(event);
    if (message) inbound.handle(message);
  };
  // toStartOfTimeline: historial paginado; nunca se procesa como orden.
  const onLive = (event, room, toStartOfTimeline) => {
    if (!toStartOfTimeline) dispatch(event);
  };

  client.on(sdk.RoomEvent.Timeline, onLive);
  client.on(sdk.MatrixEventEvent.Decrypted, dispatch);
  return () => {
    client.off(sdk.RoomEvent.Timeline, onLive);
    client.off(sdk.MatrixEventEvent.Decrypted, dispatch);
  };
}
