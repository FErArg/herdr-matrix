// Preguntas en la sala de control al crear una sala de workspace: ¿invitar a alguien más?
// Una pregunta activa a la vez, en orden de llegada. Solo el dueño responde (lo filtra inbound.mjs).
// Respuestas: "no" cierra la pregunta; un MXID válido y existente invita; cualquier otro texto
// se trata como orden normal. Sin respuesta en 10 min, la pregunta caduca y no se invita a nadie.
// La cola se guarda con `persist` y se recupera con `restore` tras un reinicio del bridge.

import { validateMxid } from "./validate.mjs";

export const INVITE_TIMEOUT_MS = 10 * 60_000;

export function createInviteQueue({
  matrix,
  sendText,
  controlRoomId,
  log,
  persist = async () => {},
  restore = [],
  now = () => Date.now(),
  timeoutMs = INVITE_TIMEOUT_MS,
}) {
  // { label, roomId, expiresAt }. Tras reiniciar, expiresAt se recalcula al volver a preguntar.
  const queue = restore
    .filter((item) => typeof item?.roomId === "string" && typeof item?.label === "string")
    .map((item) => ({ label: item.label, roomId: item.roomId, expiresAt: 0 }));

  async function save() {
    await persist(queue.map(({ label, roomId }) => ({ label, roomId })));
  }

  async function askCurrent() {
    const current = queue[0];
    if (!current) return;
    current.expiresAt = now() + timeoutMs;
    const others = queue.length > 1 ? ` (hay ${queue.length - 1} más en cola)` : "";
    await sendText(
      controlRoomId,
      `¿invitar a alguien más a "${current.label}"? Responde con su MXID (@usuario:servidor) o "no". Tienes 10 min.${others}`,
    );
  }

  // Descarta la pregunta activa si caducó y pregunta la siguiente.
  async function expireIfNeeded() {
    let changed = false;
    while (queue.length && now() > queue[0].expiresAt) {
      log(`pregunta de invitación caducada para "${queue[0].label}"; no se invita a nadie`);
      queue.shift();
      changed = true;
      await askCurrent();
    }
    if (changed) await save();
  }

  async function advance() {
    queue.shift();
    await save();
    await askCurrent();
  }

  return {
    async enqueue({ label, roomId }) {
      queue.push({ label, roomId, expiresAt: 0 });
      await save();
      if (queue.length === 1) await askCurrent();
    },

    // Tras arrancar, si quedaban preguntas de antes del reinicio, vuelve a preguntar la activa.
    async resume() {
      if (queue.length) await askCurrent();
    },

    hasPending() {
      return queue.length > 0;
    },

    // Devuelve el texto de respuesta si el mensaje contesta la pregunta activa, o null si es otra cosa.
    async handle(body) {
      await expireIfNeeded();
      const current = queue[0];
      if (!current) return null;

      const text = String(body ?? "").trim();
      if (text.toLowerCase() === "no") {
        await advance();
        return `de acuerdo, no se invita a nadie a "${current.label}".`;
      }
      if (!text.startsWith("@")) return null;

      try {
        validateMxid(text);
      } catch {
        return "ese MXID no es válido. Responde otra vez con @usuario:servidor o \"no\".";
      }
      if (!(await matrix.profileExists(text))) {
        return `el usuario ${text} no existe en el servidor. Responde con otro MXID o "no".`;
      }
      try {
        await matrix.inviteUser(current.roomId, text);
      } catch (error) {
        await advance();
        log(`invitación fallida a ${current.label}: ${error.message}`);
        return `no se pudo invitar a ${text}.`;
      }
      await advance();
      return `invitación enviada a ${text} para "${current.label}".`;
    },
  };
}
