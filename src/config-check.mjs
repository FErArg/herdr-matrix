// Validación de config.json al arrancar el bridge. Si falla, el bridge niega todo:
// no abre el socket de Herdr, no toma el bloqueo y no conecta con Matrix.

import { CONFIG_VERSION } from "./store.mjs";
import { validateMxid, validateServerUrl } from "./validate.mjs";
import { KIND_TEXT } from "./notifier.mjs";

// Matrix v3+: el ID de sala es opaco y no lleva sufijo de servidor.
const ROOM_ID = /^![\w.~+/=-]{1,255}$/;
const WORKSPACE_ID = /^w\d+$/;
const ROOM_STATUS = ["active", "archived"];

// Devuelve la lista de problemas. Lista vacía = configuración válida.
export function configProblems(config) {
  const problems = [];
  if (!config || typeof config !== "object") return ["config.json no es un objeto"];
  if (config.config_version !== CONFIG_VERSION) problems.push(`config_version debe ser ${CONFIG_VERSION}`);

  try {
    validateServerUrl(config.url);
  } catch (error) {
    problems.push(`url: ${error.message}`);
  }
  try {
    validateMxid(config.owner);
  } catch (error) {
    problems.push(`owner: ${error.message}`);
  }
  if (typeof config.control_room_id !== "string" || !ROOM_ID.test(config.control_room_id)) {
    problems.push("control_room_id no es un identificador de sala válido");
  }

  if (!Array.isArray(config.rooms)) {
    problems.push("rooms debe ser una lista");
  } else {
    config.rooms.forEach((room, index) => {
      if (!room || typeof room !== "object") {
        problems.push(`rooms[${index}] no es un objeto`);
        return;
      }
      if (!WORKSPACE_ID.test(room.workspace_id ?? "")) problems.push(`rooms[${index}].workspace_id no es válido`);
      if (typeof room.room_id !== "string" || !ROOM_ID.test(room.room_id)) problems.push(`rooms[${index}].room_id no es válido`);
      if (!ROOM_STATUS.includes(room.status)) problems.push(`rooms[${index}].status debe ser active o archived`);
    });
  }

  if (config.chat !== undefined) {
    if (!config.chat || typeof config.chat !== "object") {
      problems.push("chat debe ser un objeto");
    } else if (config.chat.opencode_auto !== undefined && typeof config.chat.opencode_auto !== "boolean") {
      problems.push("chat.opencode_auto debe ser true o false");
    }
  }

  if (config.notify_events !== undefined) {
    if (!Array.isArray(config.notify_events)) {
      problems.push("notify_events debe ser una lista");
    } else {
      for (const kind of config.notify_events) {
        if (!(kind in KIND_TEXT)) problems.push(`notify_events contiene un tipo desconocido: ${String(kind).slice(0, 30)}`);
      }
    }
  }
  return problems;
}

// Lanza un error marcado como fatal: el supervisor no reintenta una configuración inválida.
export function assertConfigValid(config) {
  const problems = configProblems(config);
  if (problems.length) {
    const error = new Error(`config.json no es válido: ${problems.join("; ")}`);
    error.fatal = true;
    throw error;
  }
}
