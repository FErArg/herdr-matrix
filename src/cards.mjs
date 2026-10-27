// Tarjetas de tarea en las salas (plan 20261027-0755). Una tarjeta por panel: se abre al empezar a
// trabajar, se actualiza si el agente pide una decisión y se cierra con el resultado.
// Estado en cards.json. Solo se edita el mensaje que el propio bridge envió, en la sala donde se abrió.

import { closeStateOf, closeText, decisionText, interruptedText, openText } from "./card.mjs";

const EDIT_ATTEMPTS = 2;

export function createCards({ sender, persist, restore = [], log, now = () => Date.now() }) {
  const cards = new Map(restore.filter((card) => card?.paneId).map((card) => [card.paneId, { ...card }]));

  const save = () => persist([...cards.values()]);

  // Edita la tarjeta con reintento. Si no se puede, `false`: el llamador decide el respaldo.
  async function edit(card, text) {
    for (let attempt = 1; attempt <= EDIT_ATTEMPTS; attempt++) {
      try {
        await sender.editText(card.roomId, card.eventId, text);
        return true;
      } catch (error) {
        log(`tarjeta no actualizada (${card.paneId}, intento ${attempt}): ${error.message}`);
      }
    }
    return false;
  }

  // Si la edición falla, el estado va en un mensaje nuevo: la tarjeta no se queda con un texto antiguo sin aviso.
  async function finish(card, text, state) {
    if (await edit(card, text)) return;
    try {
      await sender.sendText(card.roomId, `Cierre no actualizado: ${state}`);
    } catch (error) {
      log(`cierre de tarjeta no enviado (${card.paneId}): ${error.message}`);
    }
  }

  return {
    get(paneId) {
      return cards.get(paneId) ?? null;
    },

    all() {
      return [...cards.values()];
    },

    // Abre la tarjeta. Si el panel ya tiene una (la tarea continúa tras una decisión), la vuelve a poner en trabajando.
    async open({ roomId, workspaceId, paneId, task }) {
      const existing = cards.get(paneId);
      if (existing) {
        await edit(existing, openText({ task: existing.task }));
        return false;
      }
      const eventId = await sender.sendText(roomId, openText({ task }));
      cards.set(paneId, { paneId, workspaceId, roomId, eventId, task: task ?? null, openedAt: now() });
      await save();
      return true;
    },

    // El agente pide una decisión: la tarjeta muestra la pregunta y cómo responder.
    async decide({ paneId, lines }) {
      const card = cards.get(paneId);
      if (!card) return false;
      await edit(card, decisionText({ task: card.task, panelLines: lines }));
      return true;
    },

    // Cierra la tarjeta con el resultado del turno (`turn` puede ser null si no se pudo leer).
    async close({ paneId, kind, turn }) {
      const card = cards.get(paneId);
      if (!card) return false;
      const state = closeStateOf({ turn, kind });
      await finish(card, closeText({ task: card.task, state, turn }), state);
      cards.delete(paneId);
      await save();
      return true;
    },

    // Tras un reinicio, las tarjetas que quedaron abiertas se cierran como interrumpidas.
    async recoverInterrupted() {
      for (const card of [...cards.values()]) {
        await finish(card, interruptedText({ task: card.task }), "interrumpida");
        cards.delete(card.paneId);
      }
      await save();
    },
  };
}
