// Flujo de `setup` y `setup --logout`.
// La entrada del usuario llega por `io` (ask, askHidden, log) para poder probarlo sin terminal.

import { join } from "node:path";
import { createMatrixClient, ENCRYPTION_ALGORITHM } from "./matrix.mjs";
import { validateMxid, validateServerUrl } from "./validate.mjs";
import { CONFIG_VERSION, loadConfig, readJson, removeDir, removeFile, writeJsonSecure } from "./store.mjs";

const DEVICE_NAME = "herdr-matrix";
const CONTROL_ROOM_NAME = "herdr-matrix control";

function configPath(dir) {
  return join(dir, "config.json");
}

function sessionPath(dir) {
  return join(dir, "session.json");
}

async function assertEncryptedRoom(client, roomId) {
  const encryption = await client.getRoomEncryption(roomId);
  if (encryption?.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new Error(`La sala ${roomId} no tiene cifrado ${ENCRYPTION_ALGORITHM}.`);
  }
}

export async function runSetup({ io, fetchImpl, dirs }) {
  const existing = await loadConfig(dirs.config);

  const urlInput = (await io.ask(`URL del servidor${existing ? ` [${existing.url}]` : ""}: `)).trim();
  const baseUrl = validateServerUrl(urlInput || existing?.url || "");

  // Si había sesión anterior, se revoca antes de crear la nueva.
  const previous = await readJson(sessionPath(dirs.state));
  if (previous) {
    try {
      await createMatrixClient({ baseUrl: previous.base_url, accessToken: previous.access_token, fetchImpl }).logout();
    } catch {
      io.log("No se pudo revocar la sesión anterior; se reemplaza igualmente.");
    }
  }

  const user = (await io.ask("Usuario del bot: ")).trim();
  const password = await io.askHidden("Contraseña: ");
  const anonymous = createMatrixClient({ baseUrl, fetchImpl });
  const login = await anonymous.login(user, password, DEVICE_NAME);

  const authed = createMatrixClient({ baseUrl, accessToken: login.access_token, fetchImpl });
  const who = await authed.whoami();
  if (who.user_id !== login.user_id) {
    throw new Error("El servidor devolvió un usuario distinto al del login.");
  }
  await writeJsonSecure(sessionPath(dirs.state), {
    base_url: baseUrl,
    user_id: login.user_id,
    device_id: login.device_id,
    access_token: login.access_token,
  });
  // El login crea un dispositivo nuevo: el almacén criptográfico anterior ya no le corresponde.
  await removeDir(join(dirs.state, "crypto"));
  io.log(`Sesión iniciada como ${login.user_id}.`);

  const ownerInput = (await io.ask(`MXID del usuario enlazado (dueño)${existing ? ` [${existing.owner}]` : ""}: `)).trim();
  const owner = validateMxid(ownerInput || existing?.owner || "");
  if (!(await authed.profileExists(owner))) {
    throw new Error(`El usuario ${owner} no existe en el servidor.`);
  }

  let controlRoomId = existing?.control_room_id ?? null;
  if (controlRoomId) {
    await assertEncryptedRoom(authed, controlRoomId);
    io.log(`Sala de control existente y cifrada: ${controlRoomId}.`);
  } else {
    controlRoomId = await authed.createEncryptedRoom({ name: CONTROL_ROOM_NAME, invite: [owner] });
    try {
      await assertEncryptedRoom(authed, controlRoomId);
    } catch (error) {
      await authed.leaveRoom(controlRoomId).catch(() => {});
      throw error;
    }
    io.log(`Sala de control creada y cifrada: ${controlRoomId}.`);
  }

  await writeJsonSecure(configPath(dirs.config), {
    config_version: CONFIG_VERSION,
    url: baseUrl,
    owner,
    control_room_id: controlRoomId,
    rooms: existing?.rooms ?? [],
    notify_events: existing?.notify_events ?? [],
    allowed_panes: existing?.allowed_panes ?? {},
  });
  io.log("Configuración guardada.");
  io.log("Pendiente: dispositivo E2EE del bot (ver plans/06-plan.md, Fase 0, punto 5).");
}

export async function runLogout({ io, fetchImpl, dirs }) {
  const session = await readJson(sessionPath(dirs.state));
  if (!session) {
    io.log("No hay sesión guardada.");
    return;
  }
  try {
    await createMatrixClient({ baseUrl: session.base_url, accessToken: session.access_token, fetchImpl }).logout();
    io.log("Sesión revocada en el servidor.");
  } catch (error) {
    io.log(`No se pudo revocar en el servidor (${error.message}); se borra la sesión local igualmente.`);
  }
  await removeFile(sessionPath(dirs.state));
  await removeDir(join(dirs.state, "crypto"));
  io.log("Sesión local eliminada. La configuración se mantiene.");
}
