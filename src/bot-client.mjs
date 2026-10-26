// Cliente de matrix-js-sdk del bot con crypto Rust y almacén persistente.
// Reutiliza el dispositivo de session.json: el almacén criptográfico pertenece a ese dispositivo.
// Al parar NO cierra sesión: cerrarla invalidaría el dispositivo y sus claves.

import { restoreStore, saveStore } from "./crypto-store.mjs";
import * as sdk from "matrix-js-sdk";

const CRYPTO_PREFIX = "herdr-matrix";
const SAVE_INTERVAL_MS = 60_000;
const PREPARE_TIMEOUT_MS = 60_000;

function waitForSync(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sincronización inicial con Matrix agotó el tiempo")), PREPARE_TIMEOUT_MS);
    client.once(sdk.ClientEvent.Sync, (state) => {
      if (state === "PREPARED") {
        clearTimeout(timer);
        resolve();
      } else if (state === "ERROR") {
        clearTimeout(timer);
        reject(new Error("error en la sincronización inicial con Matrix"));
      }
    });
  });
}

// beforeStart(client) corre antes de la primera sincronización: los listeners ya están
// activos cuando llegan los eventos de la sincronización inicial (si no, se pierden).
export async function startBotClient({ session, cryptoDir, beforeStart }) {
  await restoreStore(cryptoDir);

  const client = sdk.createClient({
    baseUrl: session.base_url,
    userId: session.user_id,
    accessToken: session.access_token,
    deviceId: session.device_id,
  });
  await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: CRYPTO_PREFIX });
  beforeStart?.(client);

  const ready = waitForSync(client);
  await client.startClient({ initialSyncLimit: 5 });
  await ready;

  const timer = setInterval(() => {
    saveStore(cryptoDir, CRYPTO_PREFIX).catch(() => {});
  }, SAVE_INTERVAL_MS);

  return {
    client,
    async stop() {
      clearInterval(timer);
      client.stopClient();
      await saveStore(cryptoDir, CRYPTO_PREFIX);
    },
  };
}
