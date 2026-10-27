// Ejecuta el bridge (salida Herdr → Matrix y entrada sala → Herdr) hasta SIGINT/SIGTERM.
// Si la suscripción de Herdr se cierra, lanza un error: el supervisor (src/supervisor.mjs) lo reinicia.
// Un error fatal (configuración o sesión ausente) no se reintenta.

import { join } from "node:path";
import { acquireLock } from "./lock.mjs";
import { startBotClient } from "./bot-client.mjs";
import { assertSafeSocket, createHerdrClient, defaultSocketPath } from "./herdr.mjs";
import { createAudit } from "./audit.mjs";
import { createCards } from "./cards.mjs";
import { createChatManager } from "./chat.mjs";
import { createInbound } from "./inbound.mjs";
import { createInviteQueue } from "./invites.mjs";
import { attachInbound } from "./inbound-events.mjs";
import { createMatrixClient } from "./matrix.mjs";
import { createOutbound, SUBSCRIPTION_TYPES } from "./outbound.mjs";
import { createRotator } from "./rotate.mjs";
import { createRoomManager } from "./rooms.mjs";
import { createRoomSender } from "./sender.mjs";
import { loadConfig, readJson, writeJsonSecure } from "./store.mjs";
import { assertConfigValid } from "./config-check.mjs";

const ROTATION_CHECK_MS = 60_000;

function fatal(message) {
  return Object.assign(new Error(message), { fatal: true });
}

export async function runBridge({ dirs, log, socketPath = defaultSocketPath() }) {
  const configPath = join(dirs.config, "config.json");
  // Un error fatal no se reintenta. Con configuración inválida no se conecta a Herdr ni a Matrix.
  const config = await loadConfig(dirs.config);
  if (!config) throw fatal("no hay config.json; ejecuta setup primero");
  assertConfigValid(config);
  const session = await readJson(join(dirs.state, "session.json"));
  if (!session) throw fatal("no hay sesión de Matrix; ejecuta setup primero");

  await assertSafeSocket(socketPath);
  const releaseLock = await acquireLock(join(dirs.state, "bridge.lock"));

  let bot = null;
  let outbound = null;
  let subscription = null;
  let detachInbound = null;
  let sender = null;
  let failure = null;
  let rotationTimer = null;
  const onSignal = () => stopRequested();
  let stopRequested;
  const stopped = new Promise((resolve) => {
    stopRequested = resolve;
  });

  try {
    const herdr = createHerdrClient(socketPath);
    const matrix = createMatrixClient({ baseUrl: session.base_url, accessToken: session.access_token });
    // Las preguntas de invitación se envían con el remitente del bot, que existe tras el arranque.
    const invitesPath = join(dirs.state, "pending-invites.json");
    const invites = createInviteQueue({
      matrix,
      sendText: (roomId, text) => sender.sendText(roomId, text),
      controlRoomId: config.control_room_id,
      log,
      restore: (await readJson(invitesPath)) ?? [],
      persist: (items) => writeJsonSecure(invitesPath, items),
    });
    // Sesiones de chat con agentes. Las colas pendientes de antes del reinicio quedan en pausa.
    const chatsPath = join(dirs.state, "chats.json");
    const chats = createChatManager({
      herdr,
      sendText: (roomId, text) => sender.sendText(roomId, text),
      persistAll: (items) => writeJsonSecure(chatsPath, items),
      restore: (await readJson(chatsPath)) ?? [],
      log,
      opencodeAuto: config.chat?.opencode_auto ?? true,
    });
    for (const restored of chats.all()) {
      if (restored.queue.length) chats.get(restored.roomId).pauseForResume();
    }

    // La entrada se conecta antes de la primera sincronización: así no se pierden órdenes del arranque.
    bot = await startBotClient({
      session,
      cryptoDir: join(dirs.state, "crypto"),
      beforeStart: (client) => {
        sender = createRoomSender({ client });
        const inbound = createInbound({
          herdr,
          sender,
          config,
          botUserId: session.user_id,
          isEncrypted: (roomId) => client.getCrypto().isEncryptionEnabledInRoom(roomId),
          membership: (roomId, userId) => client.getRoom(roomId)?.getMember(userId)?.membership ?? null,
          audit: createAudit(join(dirs.state, "audit.log")),
          invites,
          chats,
          log,
        });
        detachInbound = attachInbound(client, inbound);
      },
    });
    log("cliente de Matrix sincronizado (E2EE activo)");
    await invites.resume();
    for (const paused of chats.pending()) {
      const minutes = paused.oldestAgeMinutes();
      await sender.sendText(
        paused.roomId,
        `tienes ${paused.queued} mensaje(s) del chat de hace ${minutes} min, pendientes tras reiniciar. Responde confirmar para enviarlos o descartar para borrarlos.`,
      ).catch((error) => log(`aviso de reanudación no enviado: ${error.message}`));
    }

    const snapshotPath = join(dirs.state, "herdr-snapshot.json");
    const snapshot = (await readJson(snapshotPath)) ?? {};
    const rooms = createRoomManager({
      matrix,
      sendText: sender.sendText,
      config,
      saveConfig: (data) => writeJsonSecure(configPath, data),
      log,
      onCreated: (created) => invites.enqueue(created),
    });
    // Tarjetas de tarea. Las que quedaron abiertas antes de reiniciar se cierran como interrumpidas.
    const cardsPath = join(dirs.state, "cards.json");
    const cards = createCards({
      sender,
      persist: (items) => writeJsonSecure(cardsPath, items),
      restore: (await readJson(cardsPath)) ?? [],
      log,
    });
    await cards.recoverInterrupted();
    outbound = createOutbound({
      herdr,
      sender,
      rooms,
      chats,
      cards,
      config,
      snapshot,
      saveSnapshot: (data) => writeJsonSecure(snapshotPath, data),
      log,
    });

    subscription = await herdr.subscribe(SUBSCRIPTION_TYPES, {
      onEvent: () => outbound.signal(),
      onLost: (reason) => {
        if (reason === "closed") {
          // Fallo, no parada: el supervisor reinicia el bridge.
          failure = new Error("la suscripción a Herdr se cerró");
          stopRequested();
        } else {
          outbound.signal(); // events_lost: se re-lee el estado, no se reproducen eventos
        }
      },
    });

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    await outbound.start();
    log("bridge activo; esperando eventos de Herdr");
    // Rotación de registros: al superar 10 MB o al cambiar el día (ver src/rotate.mjs).
    const rotators = [
      createRotator({ path: join(dirs.state, "bridge.log"), mode: "copy" }),
      createRotator({ path: join(dirs.state, "audit.log"), mode: "rename" }),
    ];
    const rotate = async () => {
      for (const rotator of rotators) {
        try {
          await rotator.check();
        } catch (error) {
          log(`rotación de registros fallida: ${error.message}`);
        }
      }
    };
    await rotate();
    rotationTimer = setInterval(rotate, ROTATION_CHECK_MS);
    await stopped;
    if (failure) throw failure;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    clearInterval(rotationTimer);
    outbound?.stop();
    detachInbound?.();
    subscription?.close();
    if (bot) await bot.stop();
    await releaseLock();
  }
}
