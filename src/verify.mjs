// Verificación del dispositivo del bot desde el cliente del dueño, con el QR en la consola.
// El bot pide la verificación en la sala de control; el dueño la acepta en Element y escanea el QR
// que muestra la consola (Verificar por escaneo). Si el bot no tiene cross-signing, lo crea:
// pide la contraseña de su cuenta sin eco y la usa solo en memoria. No se guarda.
// Requiere que el bridge no esté en marcha: ambos usan el mismo almacén criptográfico.

import { join } from "node:path";
import { startBotClient } from "./bot-client.mjs";
import { acquireLock } from "./lock.mjs";
import { renderQr } from "./qr.mjs";
import { loadConfig, readJson } from "./store.mjs";
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from "matrix-js-sdk/lib/crypto-api/verification.js";

const RESPONSE_TIMEOUT_MS = 5 * 60_000;
const BOOTSTRAP_TIMEOUT_MS = 60_000;

// Rechaza si la promesa no termina a tiempo. No cancela la operación del SDK, solo deja de esperarla.
export function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Espera a una fase de la solicitud. Falla si se cancela o si no llega a tiempo.
function waitForPhase(request, wanted, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      request.off(VerificationRequestEvent.Change, check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (request.phase === wanted) finish(null);
      else if (request.phase === VerificationPhase.Cancelled) finish(new Error("verificación cancelada"));
    };
    timer = setTimeout(() => finish(new Error(timeoutMessage)), RESPONSE_TIMEOUT_MS);
    request.on(VerificationRequestEvent.Change, check);
    check();
  });
}

// Verificación por emojis (SAS). El bot muestra 7 emojis; el dueño los compara en Element.
// Solo se confirma si el usuario responde "si" en la consola.
async function verifyWithEmoji({ request, io }) {
  const verifier = await request.startVerification("m.sas.v1");
  const finished = verifier.verify();
  finished.catch(() => {}); // si se cancela antes de mostrar los emojis, se gestiona abajo

  const sas = await new Promise((resolve, reject) => {
    const existing = verifier.getShowSasCallbacks();
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      verifier.off(VerifierEvent.ShowSas, onShow);
      reject(new Error("los emojis no se mostraron a tiempo"));
    }, RESPONSE_TIMEOUT_MS);
    const onShow = (callbacks) => {
      clearTimeout(timer);
      resolve(callbacks);
    };
    verifier.once(VerifierEvent.ShowSas, onShow);
  });

  io.log(`emojis: ${sas.sas.emoji.map(([emoji, name]) => `${emoji} ${name}`).join("  ")}`);
  const answer = (await io.ask("¿coinciden con los de Element? (si/no): ")).trim().toLowerCase();
  if (answer !== "si") {
    verifier.cancel(new Error("los emojis no coinciden"));
    throw new Error("los emojis no coinciden; verificación cancelada");
  }
  await sas.confirm();
  await finished;
}

export async function runVerify({ io, dirs }) {
  const config = await loadConfig(dirs.config);
  if (!config) throw new Error("no hay config.json; ejecuta setup primero");
  const session = await readJson(join(dirs.state, "session.json"));
  if (!session) throw new Error("no hay sesión de Matrix; ejecuta setup primero");

  const releaseLock = await acquireLock(join(dirs.state, "bridge.lock"));
  let bot = null;
  try {
    bot = await startBotClient({ session, cryptoDir: join(dirs.state, "crypto") });
    const crypto = bot.client.getCrypto();

    if (!(await crypto.isCrossSigningReady())) {
      const password = await io.askHidden("Contraseña de la cuenta del bot (no se guarda): ");
      io.log("creando claves de cross-signing del bot");
      await withTimeout(
        crypto.bootstrapCrossSigning({
          setupNewCrossSigning: true,
          authUploadDeviceSigningKeys: (makeRequest) =>
            makeRequest({
              type: "m.login.password",
              identifier: { type: "m.id.user", user: session.user_id },
              password,
            }),
        }),
        BOOTSTRAP_TIMEOUT_MS,
        "el servidor no respondió a las claves de cross-signing",
      ).catch((error) => {
        if (error.httpStatus === 401 || error.httpStatus === 403 || error.errcode === "M_FORBIDDEN") {
          throw new Error("contraseña incorrecta o rechazada por el servidor");
        }
        throw error;
      });
    }

    const request = await crypto.requestVerificationDM(config.owner, config.control_room_id);
    io.log("solicitud enviada al dueño en la sala de control: acéptala en Element");
    await waitForPhase(request, VerificationPhase.Ready, "la solicitud no se aceptó a tiempo");

    // QR si el cliente del dueño puede escanear; si no, emojis (no necesitan cámara).
    if (request.otherPartySupportsMethod("m.qr_code.scan.v1")) {
      const code = await request.generateQRCode();
      if (!code) {
        throw new Error("no se pudo generar el QR: el dispositivo no tiene cross-signing disponible");
      }
      io.log(renderQr(code));
      io.log("escanea el QR desde Element: Verificar por escaneo");
      await waitForPhase(request, VerificationPhase.Done, "el QR no se escaneó a tiempo");
    } else {
      await verifyWithEmoji({ request, io });
    }
    io.log("dispositivo del bot verificado");
  } finally {
    if (bot) await bot.stop();
    await releaseLock();
  }
}
