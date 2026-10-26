// Cliente mínimo de la Client-Server API de Matrix (sin dependencias).
// Cada petición: sin redirecciones, con timeout y con tope de tamaño de respuesta.

export const ENCRYPTION_ALGORITHM = "m.megolm.v1.aes-sha2";
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export class MatrixError extends Error {
  constructor(errcode, status, message) {
    super(message);
    this.name = "MatrixError";
    this.errcode = errcode;
    this.status = status;
  }
}

async function readLimited(response) {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new MatrixError("M_TOO_LARGE", response.status, "respuesta demasiado grande");
  }
  return new TextDecoder().decode(buffer);
}

export function createMatrixClient({ baseUrl, accessToken = null, fetchImpl = fetch }) {
  async function request(method, path, { body, auth = true, allowNotFound = false } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await readLimited(response);

    if (allowNotFound && response.status === 404) return null;
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new MatrixError("M_BAD_JSON", response.status, "respuesta no es JSON");
    }
    if (!response.ok) {
      throw new MatrixError(json?.errcode ?? "M_UNKNOWN", response.status, json?.error ?? "error del servidor");
    }
    return json;
  }

  return {
    login(user, password, deviceName) {
      return request("POST", "/_matrix/client/v3/login", {
        auth: false,
        body: {
          type: "m.login.password",
          identifier: { type: "m.id.user", user },
          password,
          initial_device_display_name: deviceName,
        },
      });
    },

    whoami() {
      return request("GET", "/_matrix/client/v3/account/whoami");
    },

    logout() {
      return request("POST", "/_matrix/client/v3/logout", { body: {} });
    },

    async profileExists(mxid) {
      const found = await request("GET", `/_matrix/client/v3/profile/${encodeURIComponent(mxid)}`, {
        auth: false,
        allowNotFound: true,
      });
      return found !== null;
    },

    async createEncryptedRoom({ name, invite }) {
      const created = await request("POST", "/_matrix/client/v3/createRoom", {
        body: {
          name,
          visibility: "private",
          preset: "private_chat",
          invite,
          initial_state: [
            { type: "m.room.encryption", state_key: "", content: { algorithm: ENCRYPTION_ALGORITHM } },
          ],
        },
      });
      return created.room_id;
    },

    // Devuelve el contenido del evento m.room.encryption, o null si no existe.
    getRoomEncryption(roomId) {
      return request(
        "GET",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`,
        { allowNotFound: true },
      );
    },

    leaveRoom(roomId) {
      return request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, { body: {} });
    },

    inviteUser(roomId, userId) {
      return request("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, { body: { user_id: userId } });
    },

    // Escribe un evento de estado. Devuelve event_id.
    async putState(roomId, type, content, stateKey = "") {
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`;
      const sent = await request("PUT", path, { body: content });
      return sent.event_id;
    },

    // Devuelve el contenido de un evento de estado, o null si no existe.
    getState(roomId, type, stateKey = "") {
      const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`;
      return request("GET", path, { allowNotFound: true });
    },
  };
}
