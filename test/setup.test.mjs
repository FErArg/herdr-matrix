import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLogout, runSetup } from "../src/setup.mjs";

const SERVER = "https://hs.example.org";
const BOT = "@bot-demo:hs.example.org";
const OWNER = "@owner:hs.example.org";
const ROOM = "!control:hs.example.org";

function jsonResponse(status, body) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Servidor simulado: registra las peticiones y responde según la ruta.
function fakeServer({ encrypted = true, ownerExists = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace(SERVER, "");
    calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === "POST" && path === "/_matrix/client/v3/login") {
      return jsonResponse(200, { user_id: BOT, access_token: "tok-1", device_id: "DEV1" });
    }
    if (path === "/_matrix/client/v3/account/whoami") return jsonResponse(200, { user_id: BOT });
    if (path.startsWith("/_matrix/client/v3/profile/")) {
      return ownerExists ? jsonResponse(200, {}) : jsonResponse(404, { errcode: "M_NOT_FOUND" });
    }
    if (path === "/_matrix/client/v3/createRoom") return jsonResponse(200, { room_id: ROOM });
    if (path.endsWith("/state/m.room.encryption/")) {
      return encrypted
        ? jsonResponse(200, { algorithm: "m.megolm.v1.aes-sha2" })
        : jsonResponse(404, { errcode: "M_NOT_FOUND" });
    }
    if (path.endsWith("/leave")) return jsonResponse(200, {});
    if (path === "/_matrix/client/v3/logout") return jsonResponse(200, {});
    return jsonResponse(500, { errcode: "M_UNKNOWN", error: `ruta no simulada ${path}` });
  };
  return { fetchImpl, calls };
}

// io con respuestas predefinidas; registra los mensajes.
function scriptedIo(answers) {
  const logs = [];
  const queue = [...answers];
  return {
    logs,
    ask: async () => queue.shift(),
    askHidden: async () => queue.shift(),
    log: (message) => logs.push(message),
  };
}

async function tempDirs() {
  return {
    config: await mkdtemp(join(tmpdir(), "hm-cfg-")),
    state: await mkdtemp(join(tmpdir(), "hm-state-")),
  };
}

const ANSWERS = [SERVER, "bot-demo", "secreto", OWNER];

test("setup crea sala cifrada, invita al dueño y guarda config y sesión", async () => {
  const dirs = await tempDirs();
  const { fetchImpl, calls } = fakeServer();
  await runSetup({ io: scriptedIo(ANSWERS), fetchImpl, dirs });

  const create = calls.find((c) => c.path === "/_matrix/client/v3/createRoom");
  assert.deepEqual(create.body.invite, [OWNER]);
  assert.equal(create.body.initial_state[0].type, "m.room.encryption");

  const config = JSON.parse(await readFile(join(dirs.config, "config.json"), "utf8"));
  assert.equal(config.config_version, 1);
  assert.equal(config.control_room_id, ROOM);
  assert.equal(config.owner, OWNER);
  assert.equal(config.url, SERVER);
  assert.ok(!JSON.stringify(config).includes("secreto"), "la contraseña no debe guardarse");

  const session = JSON.parse(await readFile(join(dirs.state, "session.json"), "utf8"));
  assert.equal(session.access_token, "tok-1");
  assert.equal((await stat(join(dirs.state, "session.json"))).mode & 0o777, 0o600);
});

test("setup no crea otra sala si ya hay una cifrada en config", async () => {
  const dirs = await tempDirs();
  const first = fakeServer();
  await runSetup({ io: scriptedIo(ANSWERS), fetchImpl: first.fetchImpl, dirs });

  const second = fakeServer();
  await runSetup({ io: scriptedIo([SERVER, "bot-demo", "secreto", OWNER]), fetchImpl: second.fetchImpl, dirs });
  assert.equal(second.calls.filter((c) => c.path === "/_matrix/client/v3/createRoom").length, 0);
});

test("setup aborta si el dueño no existe en el servidor", async () => {
  const dirs = await tempDirs();
  const { fetchImpl } = fakeServer({ ownerExists: false });
  await assert.rejects(runSetup({ io: scriptedIo(ANSWERS), fetchImpl, dirs }), /no existe/);
});

test("setup borra la sala y aborta si el cifrado no se confirma", async () => {
  const dirs = await tempDirs();
  const { fetchImpl, calls } = fakeServer({ encrypted: false });
  await assert.rejects(runSetup({ io: scriptedIo(ANSWERS), fetchImpl, dirs }), /no tiene cifrado/);
  assert.ok(calls.some((c) => c.path === `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/leave`));
  await assert.rejects(readFile(join(dirs.config, "config.json"), "utf8"), /ENOENT/);
});

test("setup --logout revoca la sesión, borra session.json y mantiene config.json", async () => {
  const dirs = await tempDirs();
  await runSetup({ io: scriptedIo(ANSWERS), fetchImpl: fakeServer().fetchImpl, dirs });

  const { fetchImpl, calls } = fakeServer();
  await runLogout({ io: scriptedIo([]), fetchImpl, dirs });

  assert.ok(calls.some((c) => c.path === "/_matrix/client/v3/logout"));
  await assert.rejects(readFile(join(dirs.state, "session.json"), "utf8"), /ENOENT/);
  assert.match(await readFile(join(dirs.config, "config.json"), "utf8"), /control_room_id/);
});
