// Salas por pestaña de Herdr. Cada pestaña activa tiene su propia sala cifrada y privada, con nombre
// "<workspace>-<pestaña>" en minúsculas (p. ej. herdr-matrix-rama-beta). La sala del workspace sigue existiendo
// (src/rooms.mjs); las notificaciones de los paneles de una pestaña con sala van a la sala de la pestaña.
// La reconciliación compara las pestañas activas con `tab_rooms[]` de config.json:
//   - pestaña sin sala activa → crear sala, invitar al dueño y guardar el mapeo;
//   - nombre cambiado (al renombrar la pestaña o el workspace) → renombrar la sala;
//   - sala activa cuya pestaña ya no existe → archivar (aviso final y solo lectura).

import { archiveRoom, ROOM_STATE_TYPE } from "./rooms.mjs";

const MAX_SLUG_LENGTH = 60;
const FALLBACK_NAME = "pestana";
// Synapse limita las peticiones (429). Entre acciones se deja un respiro; tras un 429 se para un rato.
const ACTION_SPACING_MS = 1_000;
const RATE_LIMIT_PAUSE_MS = 60_000;
const HTTP_TOO_MANY_REQUESTS = 429;

// Minúsculas, sin acentos, y guiones donde no hay letras ni dígitos.
export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

// ("herdr-matrix", "rama beta") → "herdr-matrix-rama-beta". Si la etiqueta no tiene caracteres que Matrix
// admita en el nombre (tras slugify queda vacía), se usa el número de la pestaña: "herdr-matrix-2".
export function tabRoomName(workspaceLabel, tabLabel, tabNumber = null) {
  const numberPart = tabNumber === null || tabNumber === undefined ? "" : String(tabNumber);
  const tabPart = slugify(tabLabel) || slugify(numberPart) || FALLBACK_NAME;
  return [slugify(workspaceLabel), tabPart].filter(Boolean).join("-");
}

// Una pestaña se identifica por workspace y por tab_id: no se asume que tab_id sea único entre workspaces.
const keyOf = (item) => `${item.workspace_id}|${item.tab_id}`;

// tabs: [{ tab_id, label, workspace_id, workspace_label }] de todas las pestañas de los workspaces activos.
export function createTabRoomManager({
  matrix,
  sendText,
  config,
  saveConfig,
  log,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const tabRooms = () => {
    config.tab_rooms ??= [];
    return config.tab_rooms;
  };
  let pausedUntil = 0;

  const activeEntry = (tab) => tabRooms().find((room) => keyOf(room) === keyOf(tab) && room.status === "active");

  async function create(tab, name) {
    const roomId = await matrix.createEncryptedRoom({ name, invite: [config.owner] });
    // El mapeo se guarda antes de los eventos de estado: si fallan, la siguiente reconciliación no crea una sala duplicada.
    tabRooms().push({
      tab_id: tab.tab_id,
      workspace_id: tab.workspace_id,
      label: tab.label,
      name,
      room_id: roomId,
      status: "active",
    });
    await saveConfig(config);
    await matrix.putState(roomId, ROOM_STATE_TYPE, { workspace_id: tab.workspace_id, tab_id: tab.tab_id });
    await matrix.putState(roomId, "m.room.topic", {
      topic: `Pestaña "${tab.label}" del workspace ${tab.workspace_label}`,
    });
    log(`sala creada para la pestaña ${name}`);
  }

  async function rename(entry, name) {
    await matrix.putState(entry.room_id, "m.room.name", { name });
    entry.name = name;
    await saveConfig(config);
    log(`sala renombrada a ${name}`);
  }

  async function archive(entry) {
    await archiveRoom({ matrix, sendText }, entry.room_id);
    entry.status = "archived";
    entry.archived_at = new Date().toISOString();
    await saveConfig(config);
    log(`sala de pestaña archivada: ${entry.name}`);
  }

  // Un fallo en una pestaña no detiene las demás; se registra y se reintenta en la siguiente reconciliación.
  // Un 429 para la sincronización entera durante RATE_LIMIT_PAUSE_MS: seguir daría más 429.
  async function attempt(description, action) {
    if (now() < pausedUntil) return;
    try {
      await action();
    } catch (error) {
      if (error.status === HTTP_TOO_MANY_REQUESTS) {
        pausedUntil = now() + RATE_LIMIT_PAUSE_MS;
        log(`${description} pausado: el servidor limita las peticiones; se reintenta tras ${RATE_LIMIT_PAUSE_MS / 1000} s`);
        return;
      }
      log(`${description} fallido: ${error.message}`);
    }
    await sleep(ACTION_SPACING_MS);
  }

  async function sync(tabs) {
    for (const tab of tabs) {
      const name = tabRoomName(tab.workspace_label, tab.label, tab.number);
      const entry = activeEntry(tab);
      if (!entry) {
        await attempt(`crear sala de la pestaña ${name}`, () => create(tab, name));
      } else if (entry.name !== name) {
        await attempt(`renombrar sala de la pestaña ${name}`, () => rename(entry, name));
      }
    }

    const current = new Set(tabs.map(keyOf));
    for (const entry of tabRooms().filter((room) => room.status === "active" && !current.has(keyOf(room)))) {
      await attempt(`archivar sala de la pestaña ${entry.name}`, () => archive(entry));
    }
  }

  return { sync };
}
